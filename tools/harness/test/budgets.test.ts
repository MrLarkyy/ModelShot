import { describe, expect, it } from 'vitest';
import { checkBudgets, loadBudgets, parseBudgets, type Measured } from '../src/budgets';

const valid = {
  version: 1,
  frameTimeMs: { a: { max: 10 } },
  timeToSamplesMs: { b: { max: 20 } },
  bundleGzipBytes: { c: { max: 30 } },
};
const measured: Measured = { frameTimeMs: { a: 5 }, timeToSamplesMs: { b: 5 }, bundleGzipBytes: { c: 5 } };
const parse = (patch: object): ReturnType<typeof parseBudgets> => parseBudgets(JSON.stringify({ ...valid, ...patch }));

describe('budgets.json', () => {
  it('loads and carries version 1', () => {
    expect(loadBudgets().version).toBe(1);
  });

  it('rejects an unknown version, unknown key, missing group and bad max', () => {
    expect(() => parse({ version: 2 })).toThrow(/version 2/);
    expect(() => parse({ extra: {} })).toThrow(/unknown key "extra"/);
    expect(() => parse({ frameTimeMs: undefined })).toThrow(/missing group "frameTimeMs"/);
    expect(() => parse({ frameTimeMs: { a: { max: 0 } } })).toThrow(/max must be a positive number/);
    expect(() => parse({ frameTimeMs: { a: { max: -1 } } })).toThrow(/max must be a positive number/);
    expect(() => parse({ frameTimeMs: { a: { max: '10' } } })).toThrow(/max must be a positive number/);
    expect(() => parse({ frameTimeMs: { a: { max: 10, min: 1 } } })).toThrow(/must be/);
  });
});

describe('checkBudgets', () => {
  const budgets = parseBudgets(JSON.stringify(valid));

  it('passes inside the budget and exactly at max', () => {
    expect(checkBudgets(budgets, measured)).toEqual([]);
    expect(checkBudgets(budgets, { ...measured, frameTimeMs: { a: 10 } })).toEqual([]);
  });

  it('fails over max and names the key', () => {
    const violations = checkBudgets(budgets, { ...measured, frameTimeMs: { a: 10.5 } });
    expect(violations.map((v) => v.message)).toEqual(['frameTimeMs.a: measured 10.5 exceeds budget max 10']);
  });

  it('fails a budget without a measurement', () => {
    const violations = checkBudgets(budgets, { frameTimeMs: { a: 1 }, timeToSamplesMs: { b: 1 } });
    expect(violations.map((v) => v.message)).toEqual(['bundleGzipBytes.c: budget has no measurement']);
  });

  it('fails a measurement without a budget', () => {
    const violations = checkBudgets(budgets, { ...measured, frameTimeMs: { a: 1, z: 1 } });
    expect(violations.map((v) => v.message)).toEqual(['frameTimeMs.z: measurement has no budget']);
  });
});
