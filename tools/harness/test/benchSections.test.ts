import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BENCH_SECTION_ROWS, sectionBudgets, sectionCoverage, writeSectionMeasured } from '../src/benchSections';
import { checkBudgets, loadBudgets, type Measured } from '../src/budgets';

const budgets = loadBudgets();
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const frameRows: Partial<Measured> = {
  frameTimeMs: {
    'gradient-256': 1,
    'rt-bench-512': 1,
    'rt-bench-order-512': 1,
    'rt-frame-partial-edge-512': 1,
  },
};

describe('bench sections', () => {
  it('holds every budgets.json row in exactly one section', () => {
    expect(sectionCoverage(budgets)).toEqual([]);
  });

  it('reports a row in no section, in two sections and a section row without a budget', () => {
    const without = { ...BENCH_SECTION_ROWS, bake: BENCH_SECTION_ROWS.bake.slice(1) };
    expect(sectionCoverage(budgets, without)).toEqual(['bakeTimeMs.bake-bench-n16: in no bench section']);
    const twice = { ...BENCH_SECTION_ROWS, export: [...BENCH_SECTION_ROWS.export, 'bundleGzipBytes.app'] };
    expect(sectionCoverage(budgets, twice)).toEqual(['bundleGzipBytes.app: in export and bundle']);
    const extra = { ...BENCH_SECTION_ROWS, bake: [...BENCH_SECTION_ROWS.bake, 'bakeTimeMs.nope'] };
    expect(sectionCoverage(budgets, extra)).toEqual(['bakeTimeMs.nope: in bake but has no budget']);
  });

  it('checks a section against its own rows only', () => {
    const frames = sectionBudgets(budgets, 'frames');
    expect(checkBudgets(frames, frameRows)).toEqual([]);
    const foreign = checkBudgets(frames, { frameTimeMs: { ...frameRows.frameTimeMs, 'pt-load-200k': 1 } });
    expect(foreign.map((v) => v.message)).toEqual(['frameTimeMs.pt-load-200k: measurement has no budget']);
    const missing = checkBudgets(frames, { frameTimeMs: { 'gradient-256': 1 } });
    expect(missing).toHaveLength(3);
    expect(missing[0]?.message).toContain('budget has no measurement');
  });

  it('merges the section files and a rewrite replaces only its own rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-sections-'));
    dirs.push(dir);
    writeSectionMeasured(dir, 'frames', frameRows);
    const merged = writeSectionMeasured(dir, 'bake', { bakeTimeMs: { 'bake-bench-n16': 7 } });
    expect(JSON.parse(merged)).toMatchObject({
      frameTimeMs: { 'rt-bench-512': 1 },
      bakeTimeMs: { 'bake-bench-n16': 7 },
    });
    writeSectionMeasured(dir, 'bake', { bakeTimeMs: { 'bake-bench-n16': 9 } });
    const file = JSON.parse(readFileSync(join(dir, 'budgets-measured.json'), 'utf8')) as Measured;
    expect(file.bakeTimeMs).toEqual({ 'bake-bench-n16': 9 });
    expect(Object.keys(file.frameTimeMs)).toHaveLength(4);
  });
});
