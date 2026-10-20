import { describe, expect, it } from 'vitest';
import { budgetReport, checkBudgets, loadBudgets, parseBudgets, type Measured } from '../src/budgets';

const valid = {
  version: 1,
  frameTimeMs: { a: { max: 10 } },
  timeToSamplesMs: { b: { max: 20 } },
  bundleGzipBytes: { c: { max: 30 } },
  bakeTimeMs: { d: { max: 40 } },
  mainThreadBlockMs: { e: { max: 50 } },
};
const measured: Measured = {
  frameTimeMs: { a: 5 },
  timeToSamplesMs: { b: 5 },
  bundleGzipBytes: { c: 5 },
  bakeTimeMs: { d: 5 },
  mainThreadBlockMs: { e: 5 },
};
const parse = (patch: object): ReturnType<typeof parseBudgets> => parseBudgets(JSON.stringify({ ...valid, ...patch }));

describe('budgets.json', () => {
  it('loads and carries version 1', () => {
    expect(loadBudgets().version).toBe(1);
  });

  it('rejects an unknown version, unknown key, missing group and bad max', () => {
    expect(() => parse({ version: 2 })).toThrow(/version 2/);
    expect(() => parse({ extra: {} })).toThrow(/unknown key "extra"/);
    expect(() => parse({ frameTimeMs: undefined })).toThrow(/missing group "frameTimeMs"/);
    expect(() => parse({ bakeTimeMs: undefined })).toThrow(/missing group "bakeTimeMs"/);
    expect(() => parse({ mainThreadBlockMs: undefined })).toThrow(/missing group "mainThreadBlockMs"/);
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

  it('checks the bake groups like the others', () => {
    const violations = checkBudgets(budgets, { ...measured, bakeTimeMs: { d: 41 }, mainThreadBlockMs: { e: 50 } });
    expect(violations.map((v) => v.message)).toEqual(['bakeTimeMs.d: measured 41 exceeds budget max 40']);
  });

  it('fails a budget without a measurement', () => {
    const violations = checkBudgets(budgets, {
      frameTimeMs: { a: 1 },
      timeToSamplesMs: { b: 1 },
      bakeTimeMs: { d: 1 },
      mainThreadBlockMs: { e: 1 },
    });
    expect(violations.map((v) => v.message)).toEqual(['bundleGzipBytes.c: budget has no measurement']);
  });

  it('does not treat inherited object keys as budgeted or measured', () => {
    const violations = checkBudgets(budgets, { ...measured, frameTimeMs: { a: 1, toString: 1 } });
    expect(violations.map((v) => v.message)).toEqual(['frameTimeMs.toString: measurement has no budget']);
    const inherited = parseBudgets(JSON.stringify({ ...valid, frameTimeMs: { toString: { max: 1 } } }));
    expect(checkBudgets(inherited, measured).map((v) => v.message)).toContain(
      'frameTimeMs.toString: budget has no measurement',
    );
  });

  it('fails a measurement without a budget', () => {
    const violations = checkBudgets(budgets, { ...measured, frameTimeMs: { a: 1, z: 1 } });
    expect(violations.map((v) => v.message)).toEqual(['frameTimeMs.z: measurement has no budget']);
  });
});

describe('budgetReport', () => {
  it('prints every budget with its measurement and max', () => {
    const budgets = parseBudgets(JSON.stringify(valid));
    const values = { ...measured, frameTimeMs: { a: 0.29999999701976776 }, bundleGzipBytes: {} };
    expect(budgetReport(budgets, values)).toEqual([
      'frameTimeMs.a: measured 0.3 / max 10',
      'timeToSamplesMs.b: measured 5 / max 20',
      'bundleGzipBytes.c: measured nothing / max 30',
      'bakeTimeMs.d: measured 5 / max 40',
      'mainThreadBlockMs.e: measured 5 / max 50',
    ]);
  });
});
