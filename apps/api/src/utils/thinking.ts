import type { ThinkingLevel } from '../types';
import type { OpenRouterReasoning } from '../services/openrouter';

type ThinkingMode = 'none' | 'toggle' | 'effort' | 'budget';

const CLAUDE_THINKING_BUDGETS: Record<'low' | 'medium' | 'high', number> = {
  low: 8192,
  medium: 16384,
  high: 32768,
};

const MODEL_THINKING_MODES: Record<string, ThinkingMode> = {
  'openai/gpt-5.2': 'effort',
  'x-ai/grok-4.1-fast': 'effort',
  'anthropic/claude-opus-4.5': 'budget',
  'anthropic/claude-sonnet-4.5': 'budget',
  'google/gemini-3-pro-preview': 'none',
};

const normalizeLevel = (level: ThinkingLevel | null | undefined): 'low' | 'medium' | 'high' | null => {
  if (!level) return null;
  if (level === 'xhigh') return 'high';
  return level;
};

export const resolveThinkingConfig = (
  model: { id: string; supportsThinkingLevels: boolean },
  thinkingLevel: ThinkingLevel | null | undefined,
): { reasoning?: OpenRouterReasoning; maxTokens?: number } => {
  const mode =
    MODEL_THINKING_MODES[model.id] ?? (model.supportsThinkingLevels ? 'effort' : 'none');
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
