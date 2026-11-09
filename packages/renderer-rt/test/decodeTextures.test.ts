import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeTextures } from '../src/index';
import { testTexture } from './testScene';

const limits = { maxTextureSide: 64, maxTexturePixelsTotal: 64 * 64 };

function stubBitmaps(make: () => unknown) {
  const create = vi.fn(() => Promise.resolve(make()));
  vi.stubGlobal('createImageBitmap', create);
  return create;
}

afterEach(() => vi.unstubAllGlobals());

describe('decodeTextures with a shared bytes object', () => {
  it('decodes once and hands both textures the same bitmap', async () => {
    const create = stubBitmaps(() => ({ width: 16, height: 16, close: vi.fn() }));
    const one = testTexture();
    const result = await decodeTextures([one, { ...one }], limits, () => true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result?.bitmaps[0]).toBeTruthy();
    expect(result?.bitmaps[1]).toBe(result?.bitmaps[0]);
  });

  it('decodes distinct bytes objects separately', async () => {
    const create = stubBitmaps(() => ({ width: 16, height: 16, close: vi.fn() }));
    await decodeTextures([testTexture(), testTexture()], limits, () => true);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('warns once per texture index when the shared decode fails', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('bad'))),
    );
    const one = testTexture();
    const result = await decodeTextures([one, { ...one }], limits, () => true);
    expect(result?.bitmaps).toEqual([null, null]);
    expect(result?.warnings.map((w) => [w.code, w.texture])).toEqual([
      ['TEXTURE_DECODE_FAILED', 0],
      ['TEXTURE_DECODE_FAILED', 1],
    ]);
  });

  it('closes the shared bitmap and returns null for a stale generation', async () => {
    const close = vi.fn();
    stubBitmaps(() => ({ width: 16, height: 16, close }));
    const one = testTexture();
    expect(await decodeTextures([one, { ...one }], limits, () => false)).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it('warns per sharer with the real decoded size when it disagrees with the header', async () => {
    stubBitmaps(() => ({ width: 8, height: 4, close: vi.fn() }));
    const one = testTexture();
    const result = await decodeTextures([one, { ...one }], limits, () => true);
    expect(result?.bitmaps).toEqual([null, null]);
    expect(result?.warnings.map((w) => [w.code, w.texture])).toEqual([
      ['TEXTURE_SIZE_MISMATCH', 0],
      ['TEXTURE_SIZE_MISMATCH', 1],
    ]);
    for (const w of result?.warnings ?? []) expect(w.message).toContain('8x4');
  });
});
