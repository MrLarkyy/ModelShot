import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET_GROUPS, type BudgetGroup, type Budgets, type Measured } from './budgets';

export const BENCH_SECTIONS = ['frames', 'loads', 'pathTracer', 'export', 'bundle', 'bake'] as const;
export type BenchSection = (typeof BENCH_SECTIONS)[number];

export type SectionRows = Record<BenchSection, readonly string[]>;

/** Each section's budget rows as `group.key`. A row belongs to exactly one section (`sectionCoverage`). */
export const BENCH_SECTION_ROWS: SectionRows = {
  frames: [
    'frameTimeMs.gradient-256',
    'frameTimeMs.rt-bench-512',
    'frameTimeMs.rt-bench-order-512',
    'frameTimeMs.rt-frame-partial-edge-512',
  ],
  loads: [
    'frameTimeMs.rt-load-first-frame-200k-order',
    'frameTimeMs.rt-load-first-frame-200k-edges',
    'frameTimeMs.rt-load-first-frame-edges-hostile',
    'frameTimeMs.rt-load-first-frame-edges-weld',
    'frameTimeMs.rt-load-first-frame-200k-world',
    'frameTimeMs.pt-load-200k',
    'mainThreadBlockMs.pt-setscene-200k',
  ],
  pathTracer: [
    'timeToSamplesMs.progressive-256-n64',
    'timeToSamplesMs.pt-bench-128-n256',
    'timeToSamplesMs.pt-bench-128-n64-x2-denoised',
    'frameTimeMs.pt-bench-128-x2-denoised-step',
  ],
  export: [
    'frameTimeMs.export-turntable-64-f4-n16',
    'frameTimeMs.export-animation-64-f4-n16',
    'frameTimeMs.export-animation-atlas2048-64-f4-n16',
  ],
  bundle: [
    'bundleGzipBytes.app',
    'bundleGzipBytes.app-entry',
    'bundleGzipBytes.embed',
    'bundleGzipBytes.embed-frame',
    'bundleGzipBytes.site',
    'bundleGzipBytes.site-assets',
    'bundleGzipBytes.export',
  ],
  bake: ['bakeTimeMs.bake-bench-n16', 'mainThreadBlockMs.bake-bench', 'mainThreadBlockMs.bake-post-200k'],
};

function splitRow(row: string): [BudgetGroup, string] | undefined {
  const dot = row.indexOf('.');
  const group = row.slice(0, dot);
  return (BUDGET_GROUPS as readonly string[]).includes(group) ? [group as BudgetGroup, row.slice(dot + 1)] : undefined;
}

/** The budgets of one section, every group present, so `checkBudgets` flags a missing or a foreign row of that section. */
export function sectionBudgets(
  budgets: Budgets,
  section: BenchSection,
  rows: SectionRows = BENCH_SECTION_ROWS,
): Budgets {
  const out: Budgets = {
    version: budgets.version,
    frameTimeMs: {},
    timeToSamplesMs: {},
    bundleGzipBytes: {},
    bakeTimeMs: {},
    mainThreadBlockMs: {},
  };
  for (const row of rows[section]) {
    const parts = splitRow(row);
    const limit = parts && budgets[parts[0]][parts[1]];
    if (parts && limit) out[parts[0]][parts[1]] = limit;
  }
  return out;
}

/** Problems of the section map against the budgets: a row in no section, in two, or a section row without a budget. */
export function sectionCoverage(budgets: Budgets, rows: SectionRows = BENCH_SECTION_ROWS): string[] {
  const owners = new Map<string, BenchSection[]>();
  for (const section of BENCH_SECTIONS) {
    for (const row of rows[section]) owners.set(row, [...(owners.get(row) ?? []), section]);
  }
  const problems: string[] = [];
  for (const group of BUDGET_GROUPS) {
    for (const key of Object.keys(budgets[group])) {
      const sections = owners.get(`${group}.${key}`) ?? [];
      if (sections.length === 0) problems.push(`${group}.${key}: in no bench section`);
      else if (sections.length > 1) problems.push(`${group}.${key}: in ${sections.join(' and ')}`);
    }
  }
  for (const [row, sections] of owners) {
    const parts = splitRow(row);
    if (!parts || !Object.hasOwn(budgets[parts[0]], parts[1])) {
      problems.push(`${row}: in ${sections.join(' and ')} but has no budget`);
    }
  }
  return problems;
}

export function sectionMeasuredPath(dir: string, section: BenchSection): string {
  return join(dir, `budgets-measured-${section}.json`);
}

/**
 * Writes `budgets-measured-<section>.json` and rewrites `budgets-measured.json` as the merge of every section file
 * present, so a run where one section failed still leaves the rows of the others in the documented artefact.
 */
export function writeSectionMeasured(dir: string, section: BenchSection, measured: Partial<Measured>): string {
  writeFileSync(sectionMeasuredPath(dir, section), JSON.stringify(measured, null, 2));
  const merged: Measured = {
    frameTimeMs: {},
    timeToSamplesMs: {},
    bundleGzipBytes: {},
    bakeTimeMs: {},
    mainThreadBlockMs: {},
  };
  for (const name of BENCH_SECTIONS) {
    const path = sectionMeasuredPath(dir, name);
    if (!existsSync(path)) continue;
    const part = JSON.parse(readFileSync(path, 'utf8')) as Partial<Measured>;
    for (const group of BUDGET_GROUPS) Object.assign(merged[group], part[group] ?? {});
  }
  const json = JSON.stringify(merged, null, 2);
  writeFileSync(join(dir, 'budgets-measured.json'), json);
  return json;
}
