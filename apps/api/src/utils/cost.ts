import { ModelInfo } from '../types';

export function calculateCost(
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  model: Pick<ModelInfo, 'inputCostPerToken' | 'outputCostPerToken'>,
): number {
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  const cost = prompt * model.inputCostPerToken + completion * model.outputCostPerToken;
  return Number.isFinite(cost) ? Number(cost.toFixed(8)) : 0;
}
