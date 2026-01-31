import type { ThinkingLevel } from '../types';
import type { OpenRouterReasoning } from '../services/openrouter';

type ThinkingMode = 'none' | 'toggle' | 'effort' | 'budget';

const CLAUDE_THINKING_BUDGETS: Record<'low' | 'medium' | 'high' | 'xhigh', number> = {
  low: 8192,
  medium: 16384,
  high: 32768,
  xhigh: 65536,
};

const getThinkingMode = (model: { id: string; supportsThinkingLevels: boolean }): ThinkingMode => {
  if (!model.supportsThinkingLevels) return 'none';
  if (model.id.startsWith('anthropic/')) return 'budget';
  return 'effort';
};

const normalizeLevel = (level: ThinkingLevel | null | undefined): ThinkingLevel | null => {
  if (!level) return null;
  return level;
};

export const resolveThinkingConfig = (
  model: { id: string; supportsThinkingLevels: boolean },
  thinkingLevel: ThinkingLevel | null | undefined,
): { reasoning?: OpenRouterReasoning; maxTokens?: number } => {
  const mode = getThinkingMode(model);
  const level = normalizeLevel(thinkingLevel);
  if (!level || mode === 'none') return {};

  if (mode === 'toggle') {
    return { reasoning: { enabled: true } };
  }

  if (mode === 'budget') {
    const budget = CLAUDE_THINKING_BUDGETS[level];
    return budget
      ? {
          reasoning: { max_tokens: budget },
          maxTokens: budget + 1024,
        }
      : {};
  }

  return { reasoning: { effort: level } };
};
