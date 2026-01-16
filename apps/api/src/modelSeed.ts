import { ModelInfo } from './types';

export const MODEL_SEED: ModelInfo[] = [
  {
    id: 'openai/gpt-5.2',
    label: 'GPT-5.2',
    inputCostPerToken: 0.00000175,
    outputCostPerToken: 0.000014,
    supportsVision: true,
    supportsThinkingLevels: true,
  },
  {
    id: 'google/gemini-3-pro-preview',
    label: 'Gemini 3 Pro',
    inputCostPerToken: 0.000002,
    outputCostPerToken: 0.000012,
    supportsVision: true,
    supportsThinkingLevels: false,
  },
  {
    id: 'anthropic/claude-opus-4.5',
    label: 'Claude Opus 4.5',
    inputCostPerToken: 0.000005,
    outputCostPerToken: 0.000025,
    supportsVision: true,
    supportsThinkingLevels: true,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    label: 'Claude Sonnet 4.5',
    inputCostPerToken: 0.000003,
    outputCostPerToken: 0.000015,
    supportsVision: true,
    supportsThinkingLevels: true,
  },
  {
    id: 'x-ai/grok-4.1-fast',
    label: 'Grok 4.1 Fast',
    inputCostPerToken: 0.0000002,
    outputCostPerToken: 0.0000005,
    supportsVision: true,
    supportsThinkingLevels: true,
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    inputCostPerToken: 0.0000008,
    outputCostPerToken: 0.000004,
    supportsVision: true,
    supportsThinkingLevels: false,
  },
];
