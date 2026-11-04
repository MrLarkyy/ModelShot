import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readJpegSize } from '../../src/index';
import { readPngSize } from '../../src/png/readPngSize';
import { buildJpegFixtures } from '../fixtures/jpeg/generate.mjs';

const DIR = new URL('../fixtures/jpeg/', import.meta.url);
const SOURCES = new Set([
  'generate.mjs',
  'generate.d.mts',
  'encodeFlatJpeg.mjs',
  'encodeFlatJpeg.d.mts',
  'encodeFlatPng.mjs',
  'encodeFlatPng.d.mts',
]);

describe('JPEG fixtures', () => {
  it('are the generator output, byte for byte, and nothing else', () => {
    const built = buildJpegFixtures();
    const committed = readdirSync(DIR).filter((name) => !SOURCES.has(name));
    expect(committed.sort()).toEqual([...built.keys()].sort());
    for (const [name, bytes] of built) {
      expect(new Uint8Array(readFileSync(new URL(name, DIR))), name).toEqual(bytes);
    }
  });

  it('have the sizes the tests rely on', () => {
    const size = (name: string) => readJpegSize(buildJpegFixtures().get(name)!);
    expect(size('crate.jpg')).toMatchObject({ ok: true, width: 32, height: 32, components: 3, progressive: false });
    expect(size('wide-exif6.jpg')).toMatchObject({ ok: true, width: 16, height: 8 });
    expect(readPngSize(buildJpegFixtures().get('wide-exif6.png')!)).toMatchObject({ ok: true, width: 16, height: 8 });
    expect(size('big-sof.jpg')).toMatchObject({ ok: true, width: 4097, height: 16 });
  });
});
