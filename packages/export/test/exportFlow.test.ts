import { describe, expect, it } from 'vitest';
import { ExportError } from '../src/ExportError';
import type { ExportProgress } from '../src/ExportOptions';
import { exportClip } from '../src/exportClip';
import { exportStill } from '../src/exportStill';
import { renderFrame } from '../src/renderFrame';
import { blobBytes, CAMERA, cubeScene, FakeRenderer } from './support';
import { decodeGif } from './decodeGif';
import { decodePng } from './decodePng';

const doc = cubeScene();
const STILL = { kind: 'still', width: 16, height: 12, camera: CAMERA, samples: 8, seed: 3 } as const;
const TURNTABLE = { ...STILL, kind: 'turntable', format: 'apng', fps: 10, frames: 4 } as const;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExportError) return error.code;
    throw error;
  }
  return 'resolved';
}

describe('renderFrame', () => {
  it('draws every sample, one per step, and reports each', async () => {
    const renderer = new FakeRenderer();
    renderer.resize({ cssWidth: 4, cssHeight: 4, devicePixelRatio: 1 });
    const seen: number[] = [];
    const image = await renderFrame(renderer, { seed: 1, samples: 5 }, undefined, (n) => seen.push(n));
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(image.width).toBe(4);
  });

  it('keeps stepping through a denoiser guide phase that draws no sample', async () => {
    const renderer = new FakeRenderer({ guideSteps: 3 });
    renderer.resize({ cssWidth: 4, cssHeight: 4, devicePixelRatio: 1 });
    const seen: number[] = [];
    await renderFrame(renderer, { seed: 1, samples: 2 }, undefined, (n) => seen.push(n));
    expect(seen).toEqual([0, 0, 0, 1, 2]);
  });

  it('still ends with CANCELLED when a step draws nothing outside a guide phase', async () => {
    const renderer = new FakeRenderer();
    renderer.resize({ cssWidth: 4, cssHeight: 4, devicePixelRatio: 1 });
    const pending = renderFrame(renderer, { seed: 1, samples: 5 }, undefined, (n) => {
      if (n === 2) renderer.cancel();
    });
    expect(await codeOf(pending)).toBe('CANCELLED');
  });

  it('rejects with CONTEXT_LOST instead of reading a blank frame', async () => {
    const lost = new FakeRenderer({ loseAtSample: 3 });
    lost.resize({ cssWidth: 4, cssHeight: 4, devicePixelRatio: 1 });
    expect(await codeOf(renderFrame(lost, { seed: 1, samples: 8 }, undefined, () => undefined))).toBe('CONTEXT_LOST');
    const blank = new FakeRenderer({ nullImage: true });
    blank.resize({ cssWidth: 4, cssHeight: 4, devicePixelRatio: 1 });
    expect(await codeOf(renderFrame(blank, { seed: 1, samples: 2 }, undefined, () => undefined))).toBe('CONTEXT_LOST');
  });
});

describe('exportStill', () => {
  it('encodes exactly the bytes readImage gave, with monotonic progress ending at 1', async () => {
    const renderer = new FakeRenderer();
    const progress: ExportProgress[] = [];
    const result = await exportStill(
      renderer,
      doc,
      { ...STILL, transparent: true },
      { onProgress: (p) => progress.push(p) },
    );
    expect(result).toMatchObject({ format: 'png', mimeType: 'image/png', extension: 'png', frames: 1, warnings: [] });
    const png = await decodePng(await blobBytes(result.blob));
    expect(png.frames[0]?.rgba).toEqual(new Uint8Array(renderer.readImage()!.data));
    expect(renderer.requests).toEqual([{ seed: 3, samples: 8, supersample: 1, denoise: false, transparent: true }]);
    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.filter((f) => f === 1)).toHaveLength(1);
    expect(renderer.calls.slice(0, 3)).toEqual(['resize', 'setScene', 'setCamera']);
  });

  it('checks every option before the renderer is touched', async () => {
    const renderer = new FakeRenderer();
    expect(await codeOf(exportStill(renderer, doc, { ...STILL, samples: -1 }))).toBe('INVALID_OPTION');
    expect(await codeOf(exportStill(renderer, doc, { ...STILL, width: 1e9 }))).toBe('LIMIT_EXCEEDED');
    expect(await codeOf(exportStill(renderer, doc, TURNTABLE as never))).toBe('INVALID_OPTION');
    expect(renderer.calls).toEqual([]);
  });

  it('warns when the GPU traces a lower supersample than asked for', async () => {
    const lowered = await exportStill(new FakeRenderer({ maxSupersample: 2 }), doc, { ...STILL, supersample: 3 });
    expect(lowered.warnings).toEqual([
      { code: 'SUPERSAMPLE_LOWERED', message: expect.stringMatching(/2 × 2/) as string },
    ]);
    const kept = await exportStill(new FakeRenderer({ maxSupersample: 2 }), doc, { ...STILL, supersample: 2 });
    expect(kept.warnings).toEqual([]);
    const clip = await exportClip(new FakeRenderer({ maxSupersample: 1 }), doc, { ...TURNTABLE, supersample: 2 });
    expect(clip.warnings.map((w) => w.code)).toEqual(['SUPERSAMPLE_LOWERED']);
  });

  it('fails with LIMIT_EXCEEDED when the GPU cannot render the size', async () => {
    const renderer = new FakeRenderer({ maxPixels: 100 });
    expect(await codeOf(exportStill(renderer, doc, STILL))).toBe('LIMIT_EXCEEDED');
    expect(renderer.requests).toEqual([]);
  });

  it('cancels before the next step and stops the renderer', async () => {
    const renderer = new FakeRenderer();
    const controller = new AbortController();
    const pending = exportStill(renderer, doc, STILL, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.samplesDone === 2) controller.abort();
      },
    });
    expect(await codeOf(pending)).toBe('CANCELLED');
    expect(renderer.samplesDone).toBe(2);
    expect(renderer.calls).toContain('cancel');
    const aborted = new AbortController();
    aborted.abort();
    expect(await codeOf(exportStill(new FakeRenderer(), doc, STILL, { signal: aborted.signal }))).toBe('CANCELLED');
  });
});

describe('exportClip', () => {
  it('renders a turntable with one scene upload and one seed, frame by frame into an APNG', async () => {
    const renderer = new FakeRenderer();
    const frames: Uint8Array[] = [];
    const original = renderer.readImage.bind(renderer);
    renderer.readImage = () => {
      const image = original();
      if (image) frames.push(new Uint8Array(image.data));
      return image;
    };
    const progress: ExportProgress[] = [];
    const result = await exportClip(renderer, doc, TURNTABLE, { onProgress: (p) => progress.push(p) });
    expect(result).toMatchObject({ format: 'apng', mimeType: 'image/apng', extension: 'png', frames: 4, warnings: [] });
    expect(renderer.calls.filter((c) => c === 'setScene')).toHaveLength(1);
    // One document: the tracer places the catcher under it itself.
    expect(renderer.sceneOptions[0]?.catcherBounds).toBeUndefined();
    expect(new Set(renderer.requests.map((r) => r.seed))).toEqual(new Set([3]));
    const apng = await decodePng(await blobBytes(result.blob));
    expect(apng.frames.map((f) => f.rgba)).toEqual(frames);
    // The camera turns, so the frames differ.
    expect(new Set(frames.map((f) => f.join(','))).size).toBe(4);
    const fractions = progress.map((p) => p.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
    expect(progress.map((p) => p.frame)).toEqual([...progress.map((p) => p.frame)].sort((a, b) => a - b));
  });

  it('sets each pose of an animation, all under one camera, into a GIF', async () => {
    const renderer = new FakeRenderer();
    const result = await exportClip(renderer, doc, {
      ...STILL,
      kind: 'animation',
      format: 'gif',
      fps: 4,
      animation: 'slide',
      seconds: 1,
      scene: { shadowCatcher: false },
    });
    expect(result.frames).toBe(4);
    expect(renderer.scenes).toHaveLength(4);
    // Every pose shares the textures and materials of the rest document, so the tracer reuses what it holds.
    for (const pose of renderer.scenes) {
      expect(pose.textures).toBe(doc.textures);
      expect(pose.materials).toBe(doc.materials);
    }
    expect(new Set(renderer.cameras)).toEqual(new Set([renderer.cameras[0]]));
    // One shadow catcher for every pose: the union of their bounds (the cube slides 0..1.5 along x).
    const bounds = renderer.sceneOptions.map((o) => o?.catcherBounds);
    for (const b of bounds) expect(b).toBe(bounds[0]);
    expect(bounds[0]?.min).toEqual([-1, -1, -1]);
    expect(bounds[0]?.max[0]).toBeCloseTo(2.5, 6);
    expect(renderer.sceneOptions[0]).toMatchObject({ shadowCatcher: false });
    const gif = decodeGif(await blobBytes(result.blob));
    expect(gif.frames).toHaveLength(4);
    expect(gif.frames.map((f) => f.delayCs)).toEqual([25, 25, 25, 25]);
  });

  it('falls back along the chain where the browser lacks an encoder, and renders video opaque', async () => {
    // Node has no OffscreenCanvas and no VideoEncoder: webp, webm and mp4 all end in APNG.
    for (const format of ['webp', 'webm', 'mp4'] as const) {
      const renderer = new FakeRenderer();
      const result = await exportClip(renderer, doc, { ...TURNTABLE, format, transparent: true });
      expect(result.format).toBe('apng');
      expect(result.warnings[0]).toMatchObject({ code: 'FORMAT_FALLBACK', requested: format, used: 'apng' });
      expect(result.warnings[0]?.message).toMatch(/exported as APNG instead/);
      // The fallback file is APNG, which has alpha: the request stays transparent.
      expect(renderer.requests.every((r) => r.transparent)).toBe(true);
      expect((await decodePng(await blobBytes(result.blob))).frames).toHaveLength(4);
    }
  });

  it('cancels mid-clip within one step and keeps nothing', async () => {
    const renderer = new FakeRenderer();
    const controller = new AbortController();
    const pending = exportClip(renderer, doc, TURNTABLE, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.frame === 1 && p.samplesDone === 3) controller.abort();
      },
    });
    expect(await codeOf(pending)).toBe('CANCELLED');
    expect(renderer.requests).toHaveLength(2);
    expect(renderer.samplesDone).toBe(3);
  });

  it('rejects with CONTEXT_LOST when the context goes during a clip', async () => {
    expect(await codeOf(exportClip(new FakeRenderer({ loseAtSample: 5 }), doc, TURNTABLE))).toBe('CONTEXT_LOST');
  });
});
