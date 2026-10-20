import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goldenPath, resolveGolden, type ResolveOptions } from '../src/goldenStore';
import type { RasterGoldenSpec } from '../src/goldenSpec';

const spec: RasterGoldenSpec = { kind: 'raster', fixture: 'gradient', name: 'gradient' };
const actual = Buffer.from('actual');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ms-golden-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const options = (patch: Partial<ResolveOptions>): ResolveOptions => ({
  updateMode: 'none',
  ci: false,
  allowUpdate: true,
  goldenDir: dir,
  ...patch,
});

describe('resolveGolden', () => {
  it('fails a missing golden without an update and writes nothing', () => {
    expect(() => resolveGolden(spec, actual, options({}))).toThrow(/golden missing.*pnpm golden:update gradient/);
    expect(existsSync(goldenPath(spec, dir))).toBe(false);
  });

  it('the default and missing modes do not write either', () => {
    for (const updateMode of ['default', 'missing'] as const) {
      expect(() => resolveGolden(spec, actual, options({ updateMode }))).toThrow(/golden missing/);
    }
  });

  it('changed writes a missing golden', () => {
    expect(resolveGolden(spec, actual, options({ updateMode: 'changed' }))).toEqual({ written: true });
    expect(readFileSync(goldenPath(spec, dir))).toEqual(actual);
  });

  it('changed rewrites only a golden that differs', () => {
    writeFileSync(goldenPath(spec, dir), 'old');
    expect(resolveGolden(spec, actual, options({ updateMode: 'changed' }), () => false)).toEqual({
      written: false,
      expected: Buffer.from('old'),
    });
    expect(resolveGolden(spec, actual, options({ updateMode: 'changed' }), () => true)).toEqual({ written: true });
    expect(readFileSync(goldenPath(spec, dir))).toEqual(actual);
  });

  it('none never overwrites an existing golden', () => {
    writeFileSync(goldenPath(spec, dir), 'old');
    const result = resolveGolden(spec, actual, options({}));
    expect(result).toEqual({ written: false, expected: Buffer.from('old') });
    expect(readFileSync(goldenPath(spec, dir), 'utf8')).toBe('old');
  });

  it('refuses an update request under CI', () => {
    expect(() => resolveGolden(spec, actual, options({ updateMode: 'changed', ci: true }))).toThrow(/CI is set/);
    expect(() => resolveGolden(spec, actual, options({ updateMode: 'all', ci: true }))).toThrow(/CI is set/);
    expect(existsSync(goldenPath(spec, dir))).toBe(false);
  });

  it('allowUpdate false never writes', () => {
    writeFileSync(goldenPath(spec, dir), 'old');
    resolveGolden(spec, actual, options({ updateMode: 'all', allowUpdate: false }));
    expect(readFileSync(goldenPath(spec, dir), 'utf8')).toBe('old');
  });
});
