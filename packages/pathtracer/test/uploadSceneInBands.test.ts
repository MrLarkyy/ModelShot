import type { RawImage } from '@modelshot/renderer-rt';
import { describe, expect, it } from 'vitest';
import { uploadGpuScene } from '../src/gpuScene';
import { DATA_TEXTURE_WIDTH, dataTexture, type DataTexture, type PackedGeometry } from '../src/packSceneData';
import type { TextureLayerPlan } from '../src/textureLayers';
import { BAND_ROWS, IMAGE_TASK_BYTES, uploadSceneInBands } from '../src/uploadSceneInBands';
import { stubGl, type GlCall } from './stubGl';
import { sameBytes } from './testScenes';

/** A data texture of `rows` rows whose every float is distinct. */
function numbered(rows: number, base: number): DataTexture {
  const texture = dataTexture(rows);
  texture.data.forEach((_, i) => (texture.data[i] = base + i));
  return texture;
}

const geometry: PackedGeometry = {
  nodeCount: 3,
  triangleCount: 5,
  nodes: numbered(1, 0),
  triPositions: numbered(BAND_ROWS * 2 + 5, 1e6),
  triAttributes: numbered(BAND_ROWS + 1, 2e6),
  maxRenderOrder: 2,
};
const materials = numbered(1, 3e6);

const raw = (side: number): RawImage => ({ width: side, height: side, data: new Uint8Array(side * side * 4) });
/** Two 1024² images fill a task each (4 MiB); the small ones share one. */
const images = [raw(1), raw(16), raw(1024), raw(1024), raw(8), raw(8)];
const plan: TextureLayerPlan = {
  width: 2048,
  height: 2048,
  layers: 2,
  placements: images.map((image, i) => ({ layer: i % 2, x: 0, y: 0, width: image.width, height: image.height })),
};

/** The floats each data texture received, concatenated in call order, by texture handle. */
function written(calls: readonly GlCall[]): Map<unknown, Float32Array> {
  const parts = new Map<unknown, Float32Array[]>();
  let current: unknown = null;
  for (const call of calls) {
    if (call.name === 'bindTexture') current = call.args[1];
    if (call.name === 'texSubImage2D')
      parts.set(current, [...(parts.get(current) ?? []), call.args[8] as Float32Array]);
  }
  const joined = new Map<unknown, Float32Array>();
  for (const [handle, list] of parts) {
    const all = new Float32Array(list.reduce((n, part) => n + part.length, 0));
    list.reduce((at, part) => (all.set(part, at), at + part.length), 0);
    joined.set(handle, all);
  }
  return joined;
}

describe('uploadSceneInBands', () => {
  it('writes each data texture in bands of at most BAND_ROWS rows, in row order, the bytes of uploadGpuScene', async () => {
    const { gl, calls } = stubGl();
    const scene = await uploadSceneInBands(gl, geometry, materials, plan, images, () => true);
    expect(scene).not.toBeNull();
    const bands = calls.filter((c) => c.name === 'texSubImage2D');
    for (const band of bands) {
      expect(band.args[5] as number).toBeLessThanOrEqual(BAND_ROWS);
      expect((band.args[8] as Float32Array).length).toBe((band.args[5] as number) * DATA_TEXTURE_WIDTH * 4);
    }
    expect(bands).toHaveLength(1 + 3 + 2 + 1);
    expect(bands.map((b) => b.args[3])).toEqual([0, 0, BAND_ROWS, BAND_ROWS * 2, 0, BAND_ROWS, 0]);

    const reference = stubGl();
    const whole = uploadGpuScene(reference.gl, geometry, materials, plan, images);
    const banded = written(calls);
    const once = written(reference.calls);
    for (const key of ['nodes', 'triPositions', 'triAttributes', 'materials'] as const) {
      const a = banded.get(scene?.[key]);
      const b = once.get(whole[key]);
      expect(a !== undefined && b !== undefined && a.length > 0 && sameBytes(a, b), key).toBe(true);
    }
    const layerWrites = (list: readonly GlCall[]) =>
      list
        .filter((c) => c.name === 'texSubImage3D')
        .map((c) => [c.args.slice(2, 7), images.findIndex((image) => image.data === c.args[10])]);
    expect(layerWrites(calls)).toEqual(layerWrites(reference.calls));
  });

  it('yields between bands, and groups images up to IMAGE_TASK_BYTES per task', async () => {
    const { gl, calls } = stubGl();
    // `current` runs once a task, after the task's write: what was written before each call is one task's work (the
    // height of a data band, the width of an image).
    const perTask: string[][] = [];
    let seen = 0;
    const pending = uploadSceneInBands(gl, geometry, materials, plan, images, () => {
      perTask.push(
        calls.slice(seen).flatMap((c) => (c.name.startsWith('texSubImage') ? [`${c.name}:${String(c.args[5])}`] : [])),
      );
      seen = calls.length;
      return true;
    });
    // The first band only, in the caller's task.
    expect(calls.filter((c) => c.name.startsWith('texSubImage'))).toHaveLength(1);
    await pending;
    expect(IMAGE_TASK_BYTES).toBe(1024 * 1024 * 4);
    // perTask[0] is the check before anything was made.
    expect(perTask.slice(1)).toEqual([
      ['texSubImage2D:1'],
      ['texSubImage2D:128'],
      ['texSubImage2D:128'],
      ['texSubImage2D:5'],
      ['texSubImage2D:128'],
      ['texSubImage2D:1'],
      ['texSubImage2D:1'],
      ['texSubImage3D:1', 'texSubImage3D:16'],
      ['texSubImage3D:1024'],
      ['texSubImage3D:1024'],
      ['texSubImage3D:8', 'texSubImage3D:8'],
    ]);
  });

  it('a superseded upload stops, deletes every texture it made and gives null', async () => {
    const { gl, calls } = stubGl();
    let checks = 0;
    const scene = await uploadSceneInBands(gl, geometry, materials, plan, images, () => ++checks < 3);
    expect(scene).toBeNull();
    expect(calls.filter((c) => c.name === 'texSubImage2D')).toHaveLength(2);
    const made = calls.filter((c) => c.name === 'createTexture').length;
    expect(made).toBe(5);
    expect(calls.filter((c) => c.name === 'deleteTexture')).toHaveLength(5);
  });

  it('a context lost during the upload stops it with null; one lost before makes nothing', async () => {
    let lost = false;
    const { gl, calls } = stubGl({ lost: () => lost });
    const pending = uploadSceneInBands(gl, geometry, materials, plan, images, () => true);
    lost = true;
    expect(await pending).toBeNull();
    expect(calls.filter((c) => c.name.startsWith('texSubImage'))).toHaveLength(1);

    const before = stubGl({ lost: () => true });
    expect(await uploadSceneInBands(before.gl, geometry, materials, plan, images, () => true)).toBeNull();
    expect(before.calls.filter((c) => c.name === 'createTexture')).toEqual([]);
  });
});
