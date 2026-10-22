import { DEFAULT_LOOK, LOOK_PRESETS, LookPresetError, lightingKey, type LookPreset } from '@modelshot/looks';
import type { SceneCamera } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedLighting } from '../src/BakedLighting';
import { RealtimeRenderer } from '../src/RealtimeRenderer';
import { fakeWebGl, type FakeWebGl } from './fakeWebGl';
import { quadScene } from './testScene';

const camera: SceneCamera = {
  position: [0, 0, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 45 },
  near: 0.1,
  far: 100,
};

const preset = (id: string): LookPreset => {
  const look = LOOK_PRESETS[id];
  if (!look) throw new Error(`no preset ${id}`);
  return look;
};

/** Light baked for the renderer's current layout under `look`, every texel unoccluded. */
function bakedFor(renderer: RealtimeRenderer, look: LookPreset): BakedLighting {
  const layout = renderer.lightmapLayout;
  if (!layout) throw new Error('no scene');
  return {
    layoutKey: layout.layoutKey,
    lightingKey: lightingKey(look),
    width: layout.width,
    height: layout.height,
    data: new Uint16Array(layout.width * layout.height * 4).fill(0x3c00),
    samples: 1,
    catcher: null,
  };
}

const lastValue = (fake: FakeWebGl, method: string, uniform: string): unknown =>
  fake.calls(method).findLast(([location]) => (location as { name: string }).name === uniform)?.[1];

describe('RealtimeRenderer look', () => {
  let fake: FakeWebGl;

  beforeEach(() => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 16, height: 16, close: () => undefined })),
    );
    fake = fakeWebGl();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws the default look, Studio, with the background and edges options as overrides', () => {
    expect(RealtimeRenderer.create(fake.canvas).look).toEqual(DEFAULT_LOOK);
    const renderer = RealtimeRenderer.create(fakeWebGl().canvas, {
      look: preset('marketplace'),
      background: [0.2, 0.3, 0.4],
      edges: { width: 0 },
    });
    expect(renderer.look.backdrop).toEqual({ top: [0.2, 0.3, 0.4], bottom: [0.2, 0.3, 0.4] });
    expect(renderer.look.edges).toEqual({ width: 0, sharpAngleDeg: 30 });
    expect(renderer.look.lights).toEqual(preset('marketplace').lights);
  });

  it('a background out of range or not finite throws a RangeError and builds nothing', () => {
    for (const background of [
      [NaN, 0, 0],
      [0, Infinity, 0],
      [0, 0, -0.1],
      [0, 0, 16.5],
      [0, 0],
      [1, 1, 1, 1],
    ]) {
      const canvas = fakeWebGl().canvas;
      expect(() => RealtimeRenderer.create(canvas, { background: background as [number, number, number] })).toThrow(
        RangeError,
      );
    }
  });

  it('an invalid look throws LookPresetError naming the field and changes nothing', () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    const bad = { ...preset('rim'), catcher: { strength: 2 } };
    expect(() => renderer.setLook(bad)).toThrow(LookPresetError);
    expect(() => renderer.setLook(bad)).toThrow(/^catcher\.strength/);
    expect(renderer.look).toEqual(DEFAULT_LOOK);
    expect(() => RealtimeRenderer.create(fakeWebGl().canvas, { look: bad })).toThrow(LookPresetError);
  });

  it('uploads the look once per program per frame', () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    renderer.setCamera(camera);
    const marketplace = preset('marketplace');
    renderer.setLook({ ...marketplace, toneMapping: { ...marketplace.toneMapping, exposure: 0.3 } });
    const programsBefore = fake.count('useProgram');
    const heightsBefore = fake.calls('uniform1f').filter(([l]) => (l as { name: string }).name === 'u_lookFrameHeight');
    renderer.render();
    const programs = fake.count('useProgram') - programsBefore;
    const heights =
      fake.calls('uniform1f').filter(([l]) => (l as { name: string }).name === 'u_lookFrameHeight').length -
      heightsBefore.length;
    expect(programs).toBeGreaterThan(0);
    expect(heights).toBe(programs);
    expect(lastValue(fake, 'uniform1f', 'u_lookFrameHeight')).toBe(64);
    expect(lastValue(fake, 'uniform1f', 'u_lookExposureScale')).toBeCloseTo(2 ** 0.3, 6);
    expect(lastValue(fake, 'uniform1i', 'u_lookGraded')).toBe(1);
  });

  it('keeps baked light under a look of the same lighting key, drops it under another', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    await renderer.setScene(quadScene());
    expect(renderer.setLighting(bakedFor(renderer, DEFAULT_LOOK))).toBe(true);
    const recoloured: LookPreset = {
      ...DEFAULT_LOOK,
      id: 'warm',
      backdrop: { top: [0.3, 0.2, 0.1], bottom: [0.1, 0.1, 0.1] },
    };
    renderer.setLook(recoloured);
    expect(renderer.lightingPending).toBe(true);
    renderer.setLook(preset('marketplace'));
    expect(renderer.lightingPending).toBe(false);
    renderer.dispose();
  });

  it('refuses light baked under a look of another lighting key', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    await renderer.setScene(quadScene());
    expect(renderer.setLighting(bakedFor(renderer, preset('marketplace')))).toBe(false);
    renderer.setLook(preset('marketplace'));
    expect(renderer.setLighting(bakedFor(renderer, preset('marketplace')))).toBe(true);
    expect(renderer.setLighting(bakedFor(renderer, DEFAULT_LOOK))).toBe(false);
    renderer.dispose();
  });
});
