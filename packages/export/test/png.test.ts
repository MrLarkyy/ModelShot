import type { RenderedImage } from '@modelshot/pathtracer';
import { describe, expect, it } from 'vitest';
import { adler32, crc32 } from '../src/png/checksums';
import { deflateZlib, storedZlib } from '../src/png/deflateZlib';
import { encodePng } from '../src/png/encodePng';
import { ApngEncoder } from '../src/png/ApngEncoder';
import { blobBytes } from './support';
import { decodePng, inflate } from './decodePng';

/** A frame with flat runs (pixel art), a gradient and every alpha level, varied by `seed`. */
function image(width: number, height: number, seed: number): RenderedImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const flat = x < width / 2;
      data[i] = flat ? 200 : (x * 13 + seed) & 0xff;
      data[i + 1] = flat ? 40 : (y * 7 + seed * 3) & 0xff;
      data[i + 2] = (x * y + seed) & 0xff;
      data[i + 3] = (x + y * width + seed) & 0xff;
    }
  }
  return { width, height, data };
}

describe('PNG encoding', () => {
  it('checksums match the reference values', () => {
    const text = new TextEncoder().encode('123456789');
    expect(crc32(text)).toBe(0xcbf43926);
    expect(crc32(text.subarray(0, 4), text.subarray(4))).toBe(0xcbf43926);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(new Uint8Array(100_000).fill(255))).toBe(adler32Slow(new Uint8Array(100_000).fill(255)));
  });

  it('writes stored zlib blocks any inflater reads back', async () => {
    const data = new Uint8Array(150_000).map((_, i) => (i * 31) & 0xff);
    expect(await inflate(storedZlib(data))).toEqual(data);
    expect(await inflate(storedZlib(new Uint8Array(0)))).toEqual(new Uint8Array(0));
    expect(await inflate(await deflateZlib(data))).toEqual(data);
  });

  it('decodes to exactly the input pixels, straight alpha included, with either deflate', async () => {
    const input = image(37, 23, 5);
    for (const deflate of [deflateZlib, (d: Uint8Array<ArrayBuffer>) => Promise.resolve(storedZlib(d))]) {
      const blob = await encodePng(input, deflate);
      expect(blob.type).toBe('image/png');
      const png = await decodePng(await blobBytes(blob));
      expect([png.width, png.height, png.animation]).toEqual([37, 23, null]);
      expect(png.chunkTypes).toEqual(['IHDR', 'IDAT', 'IEND']);
      expect(png.frames[0]?.rgba).toEqual(new Uint8Array(input.data));
    }
  });

  it('writes an APNG that loops forever with each frame exact, 1 / fps long and replacing the one before', async () => {
    const frames = [0, 1, 2].map((seed) => image(9, 7, seed * 50));
    const encoder = new ApngEncoder({ width: 9, height: 7, fps: 12, frames: 3 });
    for (const frame of frames) await encoder.addFrame(frame);
    const apng = await decodePng(await blobBytes(await encoder.finish()));
    expect(apng.animation).toEqual({ frames: 3, plays: 0 });
    expect(apng.chunkTypes).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'fcTL', 'fdAT', 'IEND']);
    apng.frames.forEach((frame, i) => {
      expect(frame.rgba).toEqual(new Uint8Array(frames[i]!.data));
      expect([frame.delayNum, frame.delayDen, frame.dispose, frame.blend]).toEqual([1, 12, 0, 0]);
    });
  });

  it('refuses a frame of another size and a clip short of its frames', async () => {
    const encoder = new ApngEncoder({ width: 9, height: 7, fps: 12, frames: 2 });
    await expect(encoder.addFrame(image(8, 7, 0))).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
    await encoder.addFrame(image(9, 7, 0));
    await expect(encoder.finish()).rejects.toMatchObject({ code: 'ENCODER_FAILED' });
  });
});

function adler32Slow(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
