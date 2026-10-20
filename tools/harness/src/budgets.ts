import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUDGET_VERSION = 1;

export const BUDGET_GROUPS = ['frameTimeMs', 'timeToSamplesMs', 'bundleGzipBytes'] as const;
export type BudgetGroup = (typeof BUDGET_GROUPS)[number];

export interface Budgets {
  version: number;
  frameTimeMs: Record<string, { max: number }>;
  timeToSamplesMs: Record<string, { max: number }>;
  bundleGzipBytes: Record<string, { max: number }>;
}

export type Measured = Record<BudgetGroup, Record<string, number>>;

export interface BudgetViolation {
  group: BudgetGroup;
  key: string;
  message: string;
}

export const BUDGETS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'budgets.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBudgets(json: string): Budgets {
  const raw: unknown = JSON.parse(json);
  if (!isRecord(raw)) throw new Error('budgets.json must be an object');
  if (raw['version'] !== BUDGET_VERSION) {
    throw new Error(`budgets.json version ${String(raw['version'])} is not supported (expected ${BUDGET_VERSION})`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'version' && !(BUDGET_GROUPS as readonly string[]).includes(key)) {
      throw new Error(`budgets.json has unknown key "${key}"`);
    }
  }
  const out: Record<string, unknown> = { version: BUDGET_VERSION };
  for (const group of BUDGET_GROUPS) {
    const entries = raw[group];
    if (!isRecord(entries)) throw new Error(`budgets.json is missing group "${group}"`);
    const parsed: Record<string, { max: number }> = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!isRecord(entry) || Object.keys(entry).some((k) => k !== 'max')) {
        throw new Error(`budget ${group}.${key} must be { "max": number }`);
      }
      const max = entry['max'];
      if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
        throw new Error(`budget ${group}.${key} max must be a positive number, got ${String(max)}`);
      }
      parsed[key] = { max };
    }
    out[group] = parsed;
  }
  return out as unknown as Budgets;
}

export function loadBudgets(path: string = BUDGETS_PATH): Budgets {
  return parseBudgets(readFileSync(path, 'utf8'));
}

export function checkBudgets(budgets: Budgets, measured: Partial<Measured>): BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  for (const group of BUDGET_GROUPS) {
    const limits = budgets[group];
    const values = measured[group] ?? {};
    for (const [key, { max }] of Object.entries(limits)) {
      const value = Object.hasOwn(values, key) ? values[key] : undefined;
      if (value === undefined) {
        violations.push({ group, key, message: `${group}.${key}: budget has no measurement` });
      } else if (value > max) {
        violations.push({ group, key, message: `${group}.${key}: measured ${value} exceeds budget max ${max}` });
      }
    }
    for (const key of Object.keys(values)) {
      if (!Object.hasOwn(limits, key))
        violations.push({ group, key, message: `${group}.${key}: measurement has no budget` });
    }
  }
  return violations;
}

/** One line per budget, `group.key: measured <value> / max <max>`, so a run shows its numbers, not only pass or fail. */
export function budgetReport(budgets: Budgets, measured: Partial<Measured>): string[] {
  const lines: string[] = [];
  for (const group of BUDGET_GROUPS) {
    const values = measured[group] ?? {};
    for (const [key, { max }] of Object.entries(budgets[group])) {
      const value = Object.hasOwn(values, key) ? values[key] : undefined;
      const shown = value === undefined ? 'nothing' : String(Number(value.toFixed(3)));
      lines.push(`${group}.${key}: measured ${shown} / max ${max}`);
    }
  }
  return lines;
}
