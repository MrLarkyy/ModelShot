import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePngRgba } from '../../src/png/decodePngRgba';
import { skinBytes } from '../player/skins';
import { buildPng, imageData, pngChunk, type PngSpec } from '../support/buildPng';
import { seededRandom } from '../support/seededRandom';

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const WIDTH = 13;
const HEIGHT = 11;
const PLENTY = 1 << 20;

/** Seeded samples for every channel of a `WIDTH` × `HEIGHT` image, each below `limit`. */
function samples(colourType: number, limit: number, seed: number): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: WIDTH * HEIGHT * (CHANNELS[colourType] ?? 1) }, () => Math.floor(random() * limit));
}

/** A palette of `count` entries, distinct colours. */
function palette(count: number): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => [i, (i * 7) & 255, 255 - i]);
}

/** What the decoder must return for `spec`, computed directly from the samples. */
function expectedRgba(spec: PngSpec): Uint8Array {
  const channels = CHANNELS[spec.colourType] ?? 1;
  const max = 2 ** spec.depth - 1;
  const to8 = (v: number) => (spec.depth === 16 ? v >> 8 : Math.round((v * 255) / max));
  const t = spec.transparency ?? [];
  const key = (i: number) => ((t[i * 2] ?? 0) << 8) | (t[i * 2 + 1] ?? 0);
  const out = new Uint8Array(spec.width * spec.height * 4);
  for (let p = 0; p < spec.width * spec.height; p++) {
    const s = Array.from({ length: channels }, (_, c) => spec.samples[p * channels + c] ?? 0);
    let rgba: number[];
    if (spec.colourType === 3) {
      const [r = 0, g = 0, b = 0] = spec.palette?.[s[0] ?? 0] ?? [];
      rgba = [r, g, b, t[s[0] ?? 0] ?? 255];
    } else if (spec.colourType === 0 || spec.colourType === 4) {
      const grey = s[0] ?? 0;
      const alpha = spec.colourType === 4 ? to8(s[1] ?? 0) : t.length === 2 && key(0) === grey ? 0 : 255;
      rgba = [to8(grey), to8(grey), to8(grey), alpha];
    } else {
      const [r = 0, g = 0, b = 0] = s;
      const keyed = t.length === 6 && key(0) === r && key(1) === g && key(2) === b;
      rgba = [to8(r), to8(g), to8(b), spec.colourType === 6 ? to8(s[3] ?? 0) : keyed ? 0 : 255];
    }
    out.set(rgba, p * 4);
  }
  return out;
}

function rgbaSpec(extra: Partial<PngSpec> = {}): PngSpec {
  return { width: WIDTH, height: HEIGHT, colourType: 6, depth: 8, samples: samples(6, 256, 3), ...extra };
}

const COMBINATIONS: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [0, 8],
  [0, 16],
  [2, 8],
  [2, 16],
  [3, 1],
  [3, 2],
  [3, 4],
  [3, 8],
  [4, 8],
  [4, 16],
  [6, 8],
  [6, 16],
];

describe('decodePngRgba', () => {
  for (const interlace of [0, 1]) {
    it.each(COMBINATIONS)(`decodes colour type %i at %i bits (interlace ${interlace}, every filter)`, (type, depth) => {
      const entries = type === 3 ? Math.min(2 ** depth, 200) : 0;
      const spec: PngSpec = {
        width: WIDTH,
        height: HEIGHT,
        colourType: type,
        depth,
        samples: samples(type, type === 3 ? entries : 2 ** depth, type * 100 + depth),
        interlace,
        filter: (row) => row % 5,
        ...(type === 3 ? { palette: palette(entries) } : {}),
      };
      const image = decodePngRgba(buildPng(spec), PLENTY);
      expect(image).toMatchObject({ width: WIDTH, height: HEIGHT });
      expect(image?.rgba).toEqual(expectedRgba(spec));
    });
  }

  it.each([0, 1, 2, 3, 4])('undoes filter %i on every row', (filter) => {
    const spec = rgbaSpec({ filter: () => filter });
    expect(decodePngRgba(buildPng(spec), PLENTY)?.rgba).toEqual(expectedRgba(spec));
  });

  it('decodes an Adam7 image to the same pixels as the non-interlaced one, small sizes too', () => {
    for (const [width, height] of [
      [1, 1],
      [2, 3],
      [5, 1],
      [9, 9],
      [WIDTH, HEIGHT],
    ] as const) {
      const spec = { ...rgbaSpec(), width, height, filter: (row: number) => (row * 3) % 5 };
      const plain = decodePngRgba(buildPng(spec), PLENTY);
      expect(plain?.rgba).toEqual(expectedRgba(spec));
      expect(decodePngRgba(buildPng({ ...spec, interlace: 1 }), PLENTY)).toEqual(plain);
    }
  });

  it('applies tRNS to palette entries, entries past it opaque', () => {
    const spec: PngSpec = {
      width: 4,
      height: 1,
      colourType: 3,
      depth: 2,
      samples: [0, 1, 2, 3],
      palette: palette(4),
      transparency: [0, 128],
    };
    const rgba = decodePngRgba(buildPng(spec), PLENTY)?.rgba;
    expect(Array.from(rgba ?? []).filter((_, i) => i % 4 === 3)).toEqual([0, 128, 255, 255]);
  });

  it('makes the tRNS grey or RGB value transparent, compared at full precision', () => {
    const grey: PngSpec = { width: 3, height: 1, colourType: 0, depth: 16, samples: [0x1234, 0x1235, 0x12ff] };
    const greyKeyed = decodePngRgba(buildPng({ ...grey, transparency: [0x12, 0x34] }), PLENTY)?.rgba;
    expect(Array.from(greyKeyed ?? [])).toEqual([0x12, 0x12, 0x12, 0, 0x12, 0x12, 0x12, 255, 0x12, 0x12, 0x12, 255]);
    const rgb: PngSpec = { width: 2, height: 1, colourType: 2, depth: 8, samples: [1, 2, 3, 1, 2, 4] };
    const rgbKeyed = decodePngRgba(buildPng({ ...rgb, transparency: [0, 1, 0, 2, 0, 3] }), PLENTY)?.rgba;
    expect(Array.from(rgbKeyed ?? [])).toEqual([1, 2, 3, 0, 1, 2, 4, 255]);
    const grey2: PngSpec = { width: 4, height: 1, colourType: 0, depth: 2, samples: [0, 1, 2, 3] };
    const grey2Keyed = decodePngRgba(buildPng({ ...grey2, transparency: [0, 2] }), PLENTY)?.rgba;
    expect(Array.from(grey2Keyed ?? [])).toEqual([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 0, 255, 255, 255, 255]);
  });

  it('ignores a tRNS chunk of the wrong length and one on an image with alpha', () => {
    const rgb: PngSpec = { width: 1, height: 1, colourType: 2, depth: 8, samples: [1, 2, 3], transparency: [0, 1] };
    expect(Array.from(decodePngRgba(buildPng(rgb), PLENTY)?.rgba ?? [])).toEqual([1, 2, 3, 255]);
    const rgba: PngSpec = { width: 1, height: 1, colourType: 6, depth: 8, samples: [1, 2, 3, 9], transparency: [0, 1] };
    expect(Array.from(decodePngRgba(buildPng(rgba), PLENTY)?.rgba ?? [])).toEqual([1, 2, 3, 9]);
  });

  it('keeps the high byte of 16-bit samples', () => {
    const spec: PngSpec = { width: 1, height: 1, colourType: 6, depth: 16, samples: [0x80ff, 0x7f00, 0x0001, 0xffff] };
    expect(Array.from(decodePngRgba(buildPng(spec), PLENTY)?.rgba ?? [])).toEqual([0x80, 0x7f, 0, 0xff]);
  });

  it('concatenates IDAT chunks and skips unknown chunks', () => {
    const spec = rgbaSpec({ idatChunks: 4 });
    const png = buildPng(spec);
    const text = pngChunk('tEXt', new TextEncoder().encode('Comment\0hello'));
    const withText = new Uint8Array(png.length + text.length);
    withText.set(png.subarray(0, 33));
    withText.set(text, 33);
    withText.set(png.subarray(33), 33 + text.length);
    expect(decodePngRgba(withText, PLENTY)?.rgba).toEqual(expectedRgba(spec));
  });

  it('decodes the committed test skins', () => {
    for (const skin of ['classic', 'slim', 'legacy', 'legacy-opaque-hat'] as const) {
      const image = decodePngRgba(skinBytes(skin), PLENTY);
      expect(image?.width, skin).toBe(64);
      const at = (x: number, y: number) =>
        Array.from(image?.rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4) ?? []);
      // Head front (8, 8) + probe (2, 2); (0, 0) lies outside every face region.
      expect(at(10, 10), skin).toEqual([0, 200, 200, 0]);
      expect(at(0, 0), skin).toEqual([255, 0, 255, 255]);
    }
  });

  it('honours maxPixels before decoding', () => {
    const png = buildPng(rgbaSpec());
    expect(decodePngRgba(png, WIDTH * HEIGHT)).toBeDefined();
    expect(decodePngRgba(png, WIDTH * HEIGHT - 1)).toBeUndefined();
  });

  const shortData = (spec: PngSpec) => () => new Uint8Array(deflateSync(imageData(spec).subarray(0, -1)));
  const longData = (spec: PngSpec) => () => new Uint8Array(deflateSync(Uint8Array.from([...imageData(spec), 0])));

  it.each<[string, Uint8Array]>([
    ['filter type 5', buildPng(rgbaSpec({ filter: (row) => (row === 3 ? 5 : 0) }))],
    [
      'a palette index past the palette',
      buildPng({ width: 4, height: 1, colourType: 3, depth: 2, samples: [0, 1, 2, 3], palette: palette(3) }),
    ],
    ['a palette image without PLTE', buildPng({ width: 2, height: 1, colourType: 3, depth: 8, samples: [0, 0] })],
    [
      'a 16-bit palette image',
      buildPng({ width: 1, height: 1, colourType: 3, depth: 16, samples: [0], palette: palette(1) }),
    ],
    ['an RGB image at 4 bits', buildPng({ width: 1, height: 1, colourType: 2, depth: 4, samples: [1, 2, 3] })],
    ['colour type 5', buildPng({ width: 1, height: 1, colourType: 5, depth: 8, samples: [1] })],
    ['interlace method 2', buildPng(rgbaSpec({ interlace: 2 }))],
    ['no IDAT chunk', buildPng(rgbaSpec({ idatChunks: 0 }))],
    ['image data one byte short', buildPng(rgbaSpec({ mapIdat: shortData(rgbaSpec()) }))],
    ['image data one byte long', buildPng(rgbaSpec({ mapIdat: longData(rgbaSpec()) }))],
    ['image data that is no zlib stream', buildPng(rgbaSpec({ mapIdat: () => Uint8Array.of(1, 2, 3, 4) }))],
    ['a signature only', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['no PNG signature', Uint8Array.from([0x89, 0x50, 0x4e, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
  ])('returns undefined for %s', (_name, png) => {
    expect(decodePngRgba(png, PLENTY)).toBeUndefined();
  });

  it('returns undefined for a chunk running past the end of the file', () => {
    const png = buildPng(rgbaSpec());
    const view = new DataView(png.buffer);
    // The IDAT chunk follows IHDR (8 + 25 bytes).
    view.setUint32(33, png.length);
    expect(decodePngRgba(png, PLENTY)).toBeUndefined();
    view.setUint32(33, 0xffffffff);
    expect(decodePngRgba(png, PLENTY)).toBeUndefined();
    expect(decodePngRgba(buildPng(rgbaSpec()).subarray(0, 40), PLENTY)).toBeUndefined();
  });

  it('returns undefined when IHDR is not the first chunk or has the wrong size', () => {
    const png = buildPng(rgbaSpec());
    const moved = Uint8Array.from(png);
    moved.set([0x74, 0x45, 0x58, 0x74], 12);
    expect(decodePngRgba(moved, PLENTY)).toBeUndefined();
    const long = Uint8Array.from(png);
    new DataView(long.buffer).setUint32(8, 14);
    expect(decodePngRgba(long, PLENTY)).toBeUndefined();
  });

  it('never throws on corrupted files', () => {
    const random = seededRandom(5);
    const sources = [
      buildPng(rgbaSpec({ filter: (row) => row % 5 })),
      buildPng(rgbaSpec({ interlace: 1 })),
      buildPng({ ...rgbaSpec(), colourType: 3, depth: 4, samples: samples(3, 16, 9), palette: palette(16) }),
      skinBytes('legacy'),
    ];
    for (let k = 0; k < 2000; k++) {
      const source = sources[k % sources.length] ?? new Uint8Array(0);
      let png = Uint8Array.from(source);
      if (random() < 0.3) png = png.subarray(0, Math.floor(random() * png.length));
      const flips = 1 + Math.floor(random() * 4);
      for (let f = 0; f < flips && png.length; f++) {
        const at = Math.floor(random() * png.length);
        png[at] = (png[at] ?? 0) ^ (1 << Math.floor(random() * 8));
      }
      const image = decodePngRgba(png, PLENTY);
      if (image) expect(image.rgba).toHaveLength(image.width * image.height * 4);
    }
  });
});
