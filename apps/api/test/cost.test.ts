import { describe, expect, it } from 'vitest';
import { calculateCost } from '../src/utils/cost';

describe('calculateCost', () => {
  it('calculates cost from tokens and rates', () => {
    const model = { inputCostPerToken: 0.000002, outputCostPerToken: 0.00001 };
    const cost = calculateCost(1000, 500, model);
    expect(cost).toBeCloseTo(0.000002 * 1000 + 0.00001 * 500, 8);
  });

  it('handles null tokens safely', () => {
    const model = { inputCostPerToken: 0.000002, outputCostPerToken: 0.00001 };
    const cost = calculateCost(null, undefined, model);
    expect(cost).toBe(0);
  });
});
