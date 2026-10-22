import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareImages } from '../src/compareImages';
import { goldenPath, mayWriteGolden, resolveGolden, type ResolveOptions } from '../src/goldenStore';
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
  specFile: 'my.spec',
  goldenDir: dir,
  ...patch,
});

describe('mayWriteGolden', () => {
  it('never lets a pair comparison write the golden it compares against', () => {
    expect(mayWriteGolden({ compareAgainst: spec })).toBe(false);
    expect(mayWriteGolden({ compareAgainst: spec, allowUpdate: true })).toBe(false);
  });

  it('lets a plain comparison write unless it opts out', () => {
    expect(mayWriteGolden({})).toBe(true);
    expect(mayWriteGolden({ allowUpdate: false })).toBe(false);
  });
});

describe('resolveGolden', () => {
  it('fails a missing golden without an update and writes nothing', () => {
    expect(() => resolveGolden(spec, actual, options({}))).toThrow(/golden missing.*pnpm golden:update my\.spec after/);
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

  it('changed and all rewrite an existing golden', () => {
    for (const updateMode of ['changed', 'all'] as const) {
      writeFileSync(goldenPath(spec, dir), 'old');
      expect(resolveGolden(spec, actual, options({ updateMode }))).toEqual({ written: true });
      expect(readFileSync(goldenPath(spec, dir))).toEqual(actual);
    }
  });

  it('all rewrites a golden whose change is inside the tolerance', () => {
    const png = (value: number): Buffer => {
      const image = new PNG({ width: 4, height: 4 });
      image.data.fill(128);
      image.data[0] = value;
      return PNG.sync.write(image);
    };
    const oldPng = png(128);
    const newPng = png(129);
    writeFileSync(goldenPath(spec, dir), oldPng);
    expect(compareImages(newPng, oldPng, {}).pass).toBe(true);
    expect(resolveGolden(spec, newPng, options({ updateMode: 'all' }))).toEqual({ written: true });
    expect(readFileSync(goldenPath(spec, dir))).toEqual(newPng);
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
