import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldenFileName, type GoldenSpec } from './goldenSpec';

export type UpdateMode = 'all' | 'changed' | 'missing' | 'none' | 'default';

export interface ResolveOptions {
  updateMode: UpdateMode;
  ci: boolean;
  allowUpdate: boolean;
  specFile: string;
  goldenDir?: string;
}

export type GoldenResolution = { written: true } | { written: false; expected: Buffer };

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'goldens');

export function goldenPath(spec: GoldenSpec, goldenDir: string = GOLDEN_DIR): string {
  return join(goldenDir, goldenFileName(spec));
}

export function mayWriteGolden(options: { allowUpdate?: boolean; compareAgainst?: GoldenSpec }): boolean {
  return options.compareAgainst === undefined && (options.allowUpdate ?? true);
}

function isUpdateRequest(mode: UpdateMode): boolean {
  return mode === 'all' || mode === 'changed';
}

export function resolveGolden(spec: GoldenSpec, actualPng: Buffer, options: ResolveOptions): GoldenResolution {
  if (isUpdateRequest(options.updateMode) && options.ci) {
    throw new Error(
      'golden update refused: CI is set, goldens change only through pnpm golden:update on a dev machine',
    );
  }
  const path = goldenPath(spec, options.goldenDir);
  const expected = existsSync(path) ? readFileSync(path) : null;
  if (options.allowUpdate && isUpdateRequest(options.updateMode)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actualPng);
    return { written: true };
  }
  if (expected === null) {
    throw new Error(`golden missing: ${path}; run pnpm golden:update ${options.specFile} after checking the render`);
  }
  return { written: false, expected };
}
