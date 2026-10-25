import type { Page } from '@playwright/test';
import type { ExportClipOutcome } from '../fixtures/src/exportFixture';
import { expectGolden } from '../src/expectGolden';
import type { PathTracedGoldenSpec } from '../src/goldenSpec';
import { expect, test } from '../src/harnessTest';

const SIZE = 64;

/** The 16-sample frames converge as little as any 16-sample render: every changed level counts, as in pathtracer.spec. */
const EXPORT_TOLERANCE = {
  threshold: 0,
  reason: 'threshold 0 only (default ratio and mean): a decoded export frame is exactly a 16-sample render',
};

const golden = (name: string, variant: string): PathTracedGoldenSpec => ({
  kind: 'pathtraced',
  fixture: 'export',
  name: `export-${name}`,
  variant,
  seed: 1,
  samples: 16,
  tolerance: EXPORT_TOLERANCE,
});

/** GIF: the palette bound docs/export.md gives for median cut (a 64 x 64 render keeps under 255 colours mostly). */
const GIF_TOLERANCE = 18;
/**
 * WebP at quality 1 (lossless in Chromium; 1 level measured where alpha is partial, the canvas premultiplies it) and the
 * mean error of the lossy video codecs (4.0 measured for VP9, 2.4 for H.264): measured, times 1.25, rounded up.
 */
const WEBP_TOLERANCE = 2;
const VIDEO_MEAN_TOLERANCE = 5;
/**
 * Composited over the backdrop after tone mapping vs the opaque render (tone-mapped after compositing). Solid pixels
 * (alpha 0 or 255) without the catcher: 0 measured, 2 allowed for the TS mirror of the backdrop. With the catcher every
 * pixel counts: 36 measured (silhouettes 26, the partly transparent shadow), times 1.25.
 */
const PAIR_TOLERANCE = 2;
const CATCHER_PAIR_TOLERANCE = 45;
/**
 * The same with supersample 2 (solid 0, all 36 with the catcher measured) and denoise (solid 14, all 63 measured: the
 * denoised radiance of a transparent request has no backdrop to filter, so silhouettes and the shadow edge differ).
 */
const QUALITY_PAIR_TOLERANCE = 18;
const QUALITY_CATCHER_PAIR_TOLERANCE = 79;
/**
 * The transparent canvas against the opaque one, every pixel: 0 measured plain and supersampled (the canvas composites
 * in linear light, so it is the opaque mean); denoised 14 without and 34 with the catcher (the filter sees different
 * radiance; 35 before MS-59's control variate), times 1.25.
 */
const CANVAS_TOLERANCE = 1;
const DENOISED_CANVAS_TOLERANCE = 43;
/**
 * Pixels of the transparent still (catcher on) with alpha 1..3: the faint haze per-sample catcher noise left where
 * nothing blocks, 490 in the golden before MS-59's control variate made an unblocked sample exactly coverage 0; 27
 * measured after, times 1.25. Alpha 4..15 (674 before, 695 after) is not bounded: where one fill sample of 16 is
 * blocked by the model the pixel gets alpha 4..15, unbiased speckle of real occlusion that falls as 1/√n.
 */
const HAZE_PIXELS = 34;
/** The APNG frames ImageDecoder composites, at fully opaque pixels: 0 measured. */
const APNG_DECODER_TOLERANCE = 0;

const bytes = (b64: string): Buffer => Buffer.from(b64, 'base64');

async function openExport(page: Page): Promise<void> {
  await page.goto('/export.html');
  await page.waitForFunction(() => window.__msExport !== undefined && window.__msFixture !== undefined);
  await page.evaluate(() => window.__msFixture?.ready);
}

function alphaAt(rgba: Buffer, x: number, y: number): number {
  return rgba[(Math.floor(y) * SIZE + Math.floor(x)) * 4 + 3] ?? -1;
}

/** Largest channel difference, and the mean, over pixels `include` admits. */
function difference(a: Buffer, b: Buffer, include: (i: number) => boolean = () => true): { max: number; mean: number } {
  let max = 0;
  let total = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!include(i)) continue;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0));
      max = Math.max(max, d);
      total += d;
      count++;
    }
  }
  return { max, mean: count ? total / count : 0 };
}

test.describe('export', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a transparent still PNG decodes to exactly readImage, alpha 0 where rays escape and through cut-out texels', async ({
    page,
  }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.still({ catcher: false, transparent: true }));
    expect(outcome.samplesDone).toBe(16);
    const decoded = bytes(outcome.decoded);
    expect(decoded.equals(bytes(outcome.read))).toBe(true);
    const probe = (name: string) => outcome.probes.find((p) => p.name === name)!;
    expect(alphaAt(decoded, probe('opaque-texel').x, probe('opaque-texel').y)).toBe(255);
    expect(alphaAt(decoded, probe('transparent-texel').x, probe('transparent-texel').y)).toBe(0);
    for (const [x, y] of [
      [0, 0],
      [SIZE - 1, 0],
    ]) {
      expect(alphaAt(decoded, x!, y!), `corner ${x}, ${y}`).toBe(0);
    }
  });

  test('the shadow catcher of a transparent still is black with alpha 1 - shade', async ({ page }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.still({ catcher: true, transparent: true }));
    const decoded = bytes(outcome.decoded);
    const shadow = outcome.probes.find((p) => p.name === 'shadow-of-opaque-texel')!;
    const i = (Math.floor(shadow.y) * SIZE + Math.floor(shadow.x)) * 4;
    console.log(`[export] catcher shadow probe rgba ${decoded.subarray(i, i + 4).join(',')}`);
    expect(Array.from(decoded.subarray(i, i + 3))).toEqual([0, 0, 0]);
    expect(decoded[i + 3]).toBeGreaterThan(0);
  });

  test('the lit shadow catcher of a transparent still leaves no faint alpha haze', async ({ page }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.still({ catcher: true, transparent: true }));
    const decoded = bytes(outcome.decoded);
    let haze = 0;
    for (let i = 3; i < decoded.length; i += 4) if (decoded[i]! >= 1 && decoded[i]! <= 3) haze++;
    console.log(`[export] faint catcher alpha (1..3): ${haze} px / max ${HAZE_PIXELS}`);
    expect(haze).toBeLessThanOrEqual(HAZE_PIXELS);
  });

  test('export-still-transparent matches its golden', async ({ page }, testInfo) => {
    await expectGolden(page, testInfo, golden('still-transparent', 'still-transparent'));
  });

  for (let frame = 0; frame < 4; frame++) {
    test(`export-turntable-f${frame} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, golden(`turntable-f${frame}`, `turntable-f${frame}`));
    });
    test(`export-animation-f${frame} matches its golden`, async ({ page }, testInfo) => {
      await expectGolden(page, testInfo, golden(`animation-f${frame}`, `animation-f${frame}`));
    });
  }

  test('an animation export keeps one shadow catcher under every pose while the model bobs', async ({ page }) => {
    await openExport(page);
    const outcome = await page.evaluate(() =>
      window.__msExport!.clip({ format: 'apng', transparent: true, clip: 'animation' }),
    );
    expect(outcome.frames).toBe(4);
    // One setScene per pose, every one with the same catcher bounds: the union of the poses.
    expect(outcome.catcherBounds).toHaveLength(4);
    const first = outcome.catcherBounds[0];
    expect(first).not.toBeNull();
    for (const bounds of outcome.catcherBounds) expect(bounds).toEqual(first);
    outcome.decoded.forEach((frame, i) =>
      expect(bytes(frame).equals(bytes(outcome.read[i]!)), `frame ${i}`).toBe(true),
    );
    // The model moves (frames 0 and 2 are a bob apart); the catcher stays at the rest pose's floor (y 0), its box
    // reaching the top of the bob (3 units over the model).
    expect(bytes(outcome.read[0]!).equals(bytes(outcome.read[2]!))).toBe(false);
    console.log(`[export] animation catcher bounds ${JSON.stringify(first)}`);
    expect(first?.min[1]).toBe(0);
    expect(first?.max[1]).toBe(23);
  });

  for (const format of ['apng', 'gif', 'webp', 'webm', 'mp4'] as const) {
    test(`a ${format} turntable decodes to the frames the path tracer rendered`, async ({ page }) => {
      await openExport(page);
      const started = Date.now();
      const outcome: ExportClipOutcome = await page.evaluate(
        (f) => window.__msExport!.clip({ format: f, transparent: true }),
        format,
      );
      console.log(
        `[export] ${format}: exported as ${outcome.format} (${outcome.bytes} bytes, ${outcome.decoder}) in ${Date.now() - started} ms for ${outcome.frames} frames; warnings ${JSON.stringify(outcome.warnings)}`,
      );
      expect(outcome.decoded).toHaveLength(4);
      expect(outcome.read).toHaveLength(4);
      if (outcome.format !== format) {
        // This browser cannot encode the format: the fallback chain took over (mp4 in an open-source Chromium).
        expect(outcome.warnings[0]).toMatchObject({ code: 'FORMAT_FALLBACK', requested: format, used: outcome.format });
      }
      for (let i = 0; i < 4; i++) {
        const decoded = bytes(outcome.decoded[i]!);
        const read = bytes(outcome.read[i]!);
        const opaque = (k: number) => (read[k + 3] ?? 0) >= 128;
        let result: { max: number; mean: number };
        if (outcome.format === 'apng') {
          expect(decoded.equals(read), `frame ${i}`).toBe(true);
          continue;
        } else if (outcome.format === 'gif') {
          result = difference(decoded, read, opaque);
          for (let k = 3; k < read.length; k += 4) expect(decoded[k]).toBe((read[k] ?? 0) >= 128 ? 255 : 0);
          expect(result.max).toBeLessThanOrEqual(GIF_TOLERANCE);
        } else if (outcome.format === 'webp') {
          result = difference(decoded, read, opaque);
          expect(result.max).toBeLessThanOrEqual(WEBP_TOLERANCE);
        } else {
          result = difference(decoded, read);
          expect(result.mean).toBeLessThanOrEqual(VIDEO_MEAN_TOLERANCE);
        }
        console.log(`[export] ${outcome.format} frame ${i}: max ${result.max}, mean ${result.mean.toFixed(3)}`);
      }
      if (outcome.format === 'webm' || outcome.format === 'mp4') {
        expect(outcome.warnings.map((w) => w.code)).toContain('ALPHA_DROPPED');
      }
    });
  }

  test('frames of a clip do not depend on the run: frame 0 twice is the same bytes', async ({ page }) => {
    await openExport(page);
    const first = await page.evaluate(() => window.__msExport!.clip({ format: 'apng', transparent: true }));
    const second = await page.evaluate(() => window.__msExport!.clip({ format: 'apng', transparent: true }));
    expect(bytes(first.read[0]!).equals(bytes(second.read[0]!))).toBe(true);
    expect(bytes(first.read[0]!).equals(bytes(first.read[1]!))).toBe(false);
  });

  for (const format of ['webm', 'webp'] as const) {
    test(`a ${format} the browser cannot encode exports as APNG with a warning naming both`, async ({ page }) => {
      await openExport(page);
      const outcome = await page.evaluate(
        (f) => window.__msExport!.clip({ format: f, transparent: true, refuse: [f] }),
        format,
      );
      expect(outcome.format).toBe('apng');
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings[0]).toMatchObject({ code: 'FORMAT_FALLBACK', requested: format, used: 'apng' });
      expect(outcome.warnings[0]?.message).toMatch(/exported as APNG instead/);
      outcome.decoded.forEach((frame, i) => expect(bytes(frame).equals(bytes(outcome.read[i]!))).toBe(true));
    });
  }

  test('cancel mid-clip rejects with CANCELLED and stops the path tracer within one step', async ({ page }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.cancel({ atFrame: 1, atSample: 3 }));
    expect(outcome).toEqual({ code: 'CANCELLED', samplesDone: 3, running: false, stepAfter: 0 });
  });

  test('the transparent render over the backdrop looks like the opaque render', async ({ page }) => {
    await openExport(page);
    for (const catcher of [false, true]) {
      const outcome = await page.evaluate((c) => window.__msExport!.pair({ catcher: c }), catcher);
      const alpha = bytes(outcome.alpha);
      const composited = bytes(outcome.composited);
      const opaque = bytes(outcome.opaque);
      // Silhouette pixels mix model and backdrop: tone mapping before or after the mix gives them different levels.
      const solid = (i: number) => alpha[i / 4] === 0 || alpha[i / 4] === 255;
      const strict = difference(composited, opaque, solid);
      const all = difference(composited, opaque);
      console.log(
        `[export] pair catcher ${catcher}: solid pixels max ${strict.max} mean ${strict.mean.toFixed(3)}, all pixels max ${all.max} mean ${all.mean.toFixed(3)}`,
      );
      // With the catcher its shadow is partly transparent everywhere: all pixels count, against the measured bound.
      if (catcher) expect(all.max).toBeLessThanOrEqual(CATCHER_PAIR_TOLERANCE);
      else expect(strict.max).toBeLessThanOrEqual(PAIR_TOLERANCE);
    }
  });

  for (const quality of [{}, { supersample: 2 }, { denoise: true }] as const) {
    const label = JSON.stringify(quality);
    test(`a transparent still ${label} keeps per-texel alpha and its canvas shows the opaque one`, async ({ page }) => {
      await openExport(page);
      for (const catcher of [false, true]) {
        const transparent = await page.evaluate(
          ([q, c]) => window.__msExport!.still({ ...q, catcher: c, transparent: true }),
          [quality, catcher] as const,
        );
        const opaque = await page.evaluate(
          ([q, c]) => window.__msExport!.still({ ...q, catcher: c, transparent: false }),
          [quality, catcher] as const,
        );
        const decoded = bytes(transparent.decoded);
        expect(decoded.equals(bytes(transparent.read))).toBe(true);
        expect(transparent.warnings).toEqual([]);
        if (!catcher) {
          const probe = (name: string) => transparent.probes.find((p) => p.name === name)!;
          expect(alphaAt(decoded, probe('opaque-texel').x, probe('opaque-texel').y)).toBe(255);
          expect(alphaAt(decoded, probe('transparent-texel').x, probe('transparent-texel').y)).toBe(0);
          expect(alphaAt(decoded, 0, 0)).toBe(0);
        }
        // The canvas composites in linear light: an opaque render's mean, so every pixel matches the opaque canvas
        // (coverage = 1 - shade per sample makes the catcher match too).
        const canvas = difference(bytes(transparent.canvas), bytes(opaque.canvas));
        console.log(
          `[export] canvas ${label} catcher ${catcher}: transparent vs opaque max ${canvas.max} mean ${canvas.mean.toFixed(3)}`,
        );
        expect(canvas.max).toBeLessThanOrEqual('denoise' in quality ? DENOISED_CANVAS_TOLERANCE : CANVAS_TOLERANCE);
      }
    });
  }

  for (const quality of [{ supersample: 2 }, { denoise: true }] as const) {
    test(`the readback of a transparent still ${JSON.stringify(quality)} over the backdrop looks like the opaque one`, async ({
      page,
    }) => {
      await openExport(page);
      for (const catcher of [false, true]) {
        const outcome = await page.evaluate(([q, c]) => window.__msExport!.pair({ ...q, catcher: c }), [
          quality,
          catcher,
        ] as const);
        const alpha = bytes(outcome.alpha);
        const solid = (i: number) => alpha[i / 4] === 0 || alpha[i / 4] === 255;
        const strict = difference(bytes(outcome.composited), bytes(outcome.opaque), solid);
        const all = difference(bytes(outcome.composited), bytes(outcome.opaque));
        console.log(
          `[export] pair ${JSON.stringify(quality)} catcher ${catcher}: solid max ${strict.max} mean ${strict.mean.toFixed(3)}, all max ${all.max} mean ${all.mean.toFixed(3)}`,
        );
        if (catcher) expect(all.max).toBeLessThanOrEqual(QUALITY_CATCHER_PAIR_TOLERANCE);
        else expect(strict.max).toBeLessThanOrEqual(QUALITY_PAIR_TOLERANCE);
      }
    });
  }

  test('readImage is null once the context is lost, before its event too, and an export losing it rejects', async ({
    page,
  }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.lose());
    expect(outcome).toEqual({ before: true, beforeEvent: true, afterEvent: true, clipCode: 'CONTEXT_LOST' });
  });

  for (const format of ['webm', 'mp4'] as const) {
    test(`a ${format} plays in a video element with its size, duration and frames`, async ({ page }) => {
      await openExport(page);
      const outcome = await page.evaluate((f) => window.__msExport!.video(f), format);
      console.log(
        `[export] ${format} as ${outcome.format} (${outcome.type}): ${outcome.played ? 'played' : 'not playable'}`,
      );
      if (!outcome.played) {
        // An open-source Chromium may not play H.264; the decode test covers the stream through VideoDecoder.
        expect(format).toBe('mp4');
        return;
      }
      expect([outcome.played.width, outcome.played.height]).toEqual([SIZE, SIZE]);
      // 4 frames at 8 fps.
      expect(outcome.played.duration).toBeCloseTo(0.5, 2);
      const frame = difference(bytes(outcome.played.frame), bytes(outcome.read));
      console.log(`[export] ${format} video frame 2: max ${frame.max} mean ${frame.mean.toFixed(3)}`);
      expect(frame.mean).toBeLessThanOrEqual(VIDEO_MEAN_TOLERANCE);
    });
  }

  test('the browser reads the APNG with its frame count, durations and pixels', async ({ page }) => {
    await openExport(page);
    const outcome = await page.evaluate(() => window.__msExport!.apngTiming());
    expect(outcome.frames).toBe(4);
    expect(outcome.durations).toEqual([125_000, 125_000, 125_000, 125_000]);
    outcome.decoded.forEach((frame, i) => {
      const read = bytes(outcome.read[i]!);
      const opaque = difference(bytes(frame), read, (k) => read[k + 3] === 255);
      console.log(`[export] apng ImageDecoder frame ${i}: opaque pixels max ${opaque.max}`);
      expect(opaque.max).toBeLessThanOrEqual(APNG_DECODER_TOLERANCE);
    });
  });
});
