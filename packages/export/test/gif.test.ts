import type { RenderedImage } from '@modelshot/pathtracer';
import { describe, expect, it } from 'vitest';
import { GifEncoder, MIN_GIF_DELAY_CS } from '../src/gif/GifEncoder';
import { lzwEncode } from '../src/gif/lzwEncode';
import { GIF_ALPHA_CUTOFF, quantizePalette, TRANSPARENT_INDEX } from '../src/gif/quantizePalette';
import { expectCpuBelow } from './expectCpuBelow';
import { blobBytes } from './support';
import { decodeGif } from './decodeGif';

function imageOf(width: number, height: number, pixel: (x: number, y: number) => number[]): RenderedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

/** Largest channel difference between the decoded opaque pixels and the input. */
function maxError(input: RenderedImage, rgba: Uint8Array): number {
  let worst = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if ((input.data[i + 3] as number) < GIF_ALPHA_CUTOFF) continue;
    for (let c = 0; c < 3; c++)
      worst = Math.max(worst, Math.abs((input.data[i + c] as number) - (rgba[i + c] as number)));
  }
  return worst;
}

const TWO_COLOURS = imageOf(16, 8, (x, y) =>
  ((x >> 2) + (y >> 2)) % 2 === 0 ? [180, 30, 60, 255] : [20, 200, 90, 255],
);
// 64 x 64 distinct colours: a smooth gradient, far over 255.
const GRADIENT = imageOf(64, 64, (x, y) => [x * 4, y * 4, 128, 255]);
// The documented bound for the gradient (docs/export.md): 14 levels measured, times 1.25.
const GRADIENT_TOLERANCE = 18;
// Thread CPU milliseconds for the palette and LZW of a 4096 x 4096 frame of distinct colours (docs/testing.md): 453
// measured locally (the sort-based median cut took 36.7 s of wall time), about 6.6x for a slower runner's core.
const GIF_FRAME_MS_MAX = 3000;

describe('GIF encoding', () => {
  it('keeps an image of 255 colours or fewer exact: flat pixel art stays lossless', () => {
    const frame = quantizePalette(TWO_COLOURS);
    expect(frame.colours).toBe(2);
    expect(frame.transparent).toBe(false);
    const levels = imageOf(255, 1, (x) => [x, 255 - x, (x * 7) & 0xff, 255]);
    expect(quantizePalette(levels).colours).toBe(255);
  });

  it('quantizes a gradient to 255 colours within the documented bound, the same way every time', () => {
    const frame = quantizePalette(GRADIENT);
    expect(frame.colours).toBe(255);
    expect(quantizePalette(GRADIENT)).toEqual(frame);
    const rgba = new Uint8Array(GRADIENT.data.length);
    frame.indices.forEach((index, i) => {
      rgba.set(frame.palette.subarray(index * 3, index * 3 + 3), i * 4);
    });
    console.log(`[export] GIF gradient max error ${maxError(GRADIENT, rgba)}`);
    expect(maxError(GRADIENT, rgba)).toBeLessThanOrEqual(GRADIENT_TOLERANCE);
  });

  it('makes alpha under 128 the transparent index and keeps it out of the palette', () => {
    const image = imageOf(4, 1, (x) => [255, 0, 0, [0, 127, 128, 255][x] as number]);
    const frame = quantizePalette(image);
    expect(Array.from(frame.indices)).toEqual([TRANSPARENT_INDEX, TRANSPARENT_INDEX, 0, 0]);
    expect(frame.colours).toBe(1);
    expect(frame.transparent).toBe(true);
  });

  it('LZW-encodes what the textbook decoder reads back, across table resets', () => {
    // Noise fills the 4 096 codes several times over, so the encoder clears its table.
    let state = 7;
    const noise = new Uint8Array(40_000).map(() => {
      state = (state * 1103515245 + 12345) >>> 0;
      return state >>> 24;
    });
    const encoded = lzwEncode(noise, 8);
    const gif = gifOf(200, 200, encoded);
    expect(decodeGif(gif).frames[0]?.indices).toEqual(noise);
    const small: [Uint8Array, number, number][] = [
      [new Uint8Array(0), 0, 0],
      [new Uint8Array([5]), 1, 1],
      [new Uint8Array(1000).fill(3), 1000, 1],
    ];
    for (const [indices, width, height] of small) {
      expect(decodeGif(gifOf(width, height, lzwEncode(indices, 8))).frames[0]?.indices).toEqual(indices);
    }
  });

  it('writes a looping GIF89a whose frames decode within the palette bound, transparent below alpha 128', async () => {
    const transparent = imageOf(64, 64, (x, y) => [x * 4, y * 4, 128, x < 16 ? 0 : 255]);
    const encoder = new GifEncoder({ width: 64, height: 64, fps: 30, frames: 3 });
    for (const frame of [GRADIENT, transparent, GRADIENT]) {
      await encoder.addFrame(frame);
    }
    const gif = decodeGif(await blobBytes(await encoder.finish()));
    expect([gif.width, gif.height, gif.loops, gif.frames.length]).toEqual([64, 64, 0, 3]);
    // 30 fps in centiseconds without drift: 3, 4, 3 (10 cs for 3 frames).
    expect(gif.frames.map((f) => f.delayCs)).toEqual([3, 4, 3]);
    for (const f of gif.frames) expect(f.disposal).toBe(2);
    expect(maxError(GRADIENT, gif.frames[0]!.rgba)).toBeLessThanOrEqual(GRADIENT_TOLERANCE);
    const second = gif.frames[1]!;
    expect(second.transparentIndex).toBe(TRANSPARENT_INDEX);
    for (let y = 0; y < 64; y++) {
      expect(second.rgba[(y * 64 + 3) * 4 + 3]).toBe(0);
      expect(second.rgba[(y * 64 + 40) * 4 + 3]).toBe(255);
    }
    expect(maxError(transparent, second.rgba)).toBeLessThanOrEqual(GRADIENT_TOLERANCE);
  });

  it('never writes a delay browsers would slow down', async () => {
    const encoder = new GifEncoder({ width: 16, height: 8, fps: 60, frames: 3 });
    for (let i = 0; i < 3; i++) await encoder.addFrame(TWO_COLOURS);
    const gif = decodeGif(await blobBytes(await encoder.finish()));
    expect(gif.frames.map((f) => f.delayCs)).toEqual([MIN_GIF_DELAY_CS, MIN_GIF_DELAY_CS, MIN_GIF_DELAY_CS]);
    expect(gif.frames[0]?.rgba).toEqual(new Uint8Array(TWO_COLOURS.data));
  });
});

/** A one-frame GIF around raw LZW data, for the decoder. */
function gifOf(width: number, height: number, lzw: Uint8Array): Uint8Array {
  const bytes: number[] = [
    ...new TextEncoder().encode('GIF89a'),
    width & 0xff,
    width >> 8,
    height & 0xff,
    height >> 8,
    0x70,
    0,
    0,
  ];
  bytes.push(0x2c, 0, 0, 0, 0, width & 0xff, width >> 8, height & 0xff, height >> 8, 0x87, ...new Uint8Array(768), 8);
  for (let at = 0; at < lzw.length; at += 255) {
    const block = lzw.subarray(at, at + 255);
    bytes.push(block.length, ...block);
  }
  bytes.push(0, 0x3b);
  return new Uint8Array(bytes);
}

describe('GIF encoding cost', () => {
  it('quantizes and compresses a 4096 x 4096 frame of distinct colours within its time bound', () => {
    // 2^24 pixels, every one a colour of its own: the histogram path at the largest export size.
    const side = 4096;
    const data = new Uint8ClampedArray(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      data[i * 4] = i & 0xff;
      data[i * 4 + 1] = (i >> 8) & 0xff;
      data[i * 4 + 2] = (i >> 16) & 0xff;
      data[i * 4 + 3] = 255;
    }
    const frame = expectCpuBelow(GIF_FRAME_MS_MAX, () => {
      const paletted = quantizePalette({ width: side, height: side, data });
      lzwEncode(paletted.indices, 8);
      return paletted;
    });
    expect(frame.colours).toBe(255);
  }, 60_000);
});
