import {
  animateScene,
  cameraProjection,
  cameraView,
  mat4Identity,
  mat4Multiply,
  mat4NormalMatrix,
  worldMatrices,
  type SceneCamera,
  type SceneDocument,
} from '@modelshot/scene';
import { DEFAULT_LOOK, lightingKey } from '@modelshot/looks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedLighting } from '../src/BakedLighting';
import { EXACT_SAMPLE_OFFSETS } from '../src/exactSupersample';
import { RealtimeRenderer } from '../src/RealtimeRenderer';
import { fakeWebGl, type FakeWebGl } from './fakeWebGl';
import { quadScene, testTexture } from './testScene';

const camera: SceneCamera = {
  position: [0, 0, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 45 },
  near: 0.1,
  far: 100,
};

/** The quad scene with a looping clip that moves, turns and stretches its node. */
function animatedQuad(): SceneDocument {
  const linear = 'linear' as const;
  return {
    ...quadScene(),
    animations: [
      {
        name: 'move',
        loop: 'loop',
        length: 1,
        channels: [
          {
            node: 0,
            property: 'translation',
            keyframes: [
              { time: 0, value: [0, 0, 0], interpolation: linear },
              { time: 1, value: [4, 0, 0], interpolation: linear },
            ],
          },
          { node: 0, property: 'rotation', keyframes: [{ time: 0, value: [0, 30, 0], interpolation: linear }] },
          { node: 0, property: 'scale', keyframes: [{ time: 0, value: [2, 1, 1], interpolation: linear }] },
        ],
      },
    ],
  };
}

/** Calls that decode, read back or upload: none of them may happen for another pose. */
const UPLOADS = ['texStorage2D', 'texImage2D', 'texSubImage2D', 'bufferData', 'createVertexArray', 'createBuffer'];
const READBACKS = ['readPixels'];
const DELETES = ['deleteTexture', 'deleteBuffer', 'deleteVertexArray'];

describe('RealtimeRenderer.setScene with another pose of the shown document', () => {
  let fake: FakeWebGl;
  const decode = vi.fn(() => Promise.resolve({ width: 16, height: 16, close: () => undefined }));

  beforeEach(() => {
    decode.mockClear();
    vi.stubGlobal('createImageBitmap', decode);
    fake = fakeWebGl();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes, reads back and uploads nothing, and draws with the new matrices', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    renderer.setCamera(camera);
    const doc = animatedQuad();
    expect((await renderer.setScene(doc)).applied).toBe(true);
    expect(decode).toHaveBeenCalledTimes(1);
    const before = [fake.count(...UPLOADS), fake.count(...READBACKS), fake.count(...DELETES)];
    expect(before[1]).toBe(1);

    let frame = doc;
    for (const time of [0.25, 0.5, 0.75]) {
      frame = animateScene(doc, { animation: 0, time }).document;
      expect(await renderer.setScene(frame)).toEqual({ applied: true, warnings: [] });
    }
    expect(decode).toHaveBeenCalledTimes(1);
    expect([fake.count(...UPLOADS), fake.count(...READBACKS), fake.count(...DELETES)]).toEqual(before);
    expect(renderer.needsRender).toBe(true);

    renderer.render();
    const last = (method: string, uniform: string) => {
      const call = fake.calls(method).findLast(([location]) => (location as { name: string }).name === uniform);
      return Array.from((call?.[2] as Float32Array | undefined) ?? []);
    };
    const world = worldMatrices(frame.nodes)[0] ?? mat4Identity();
    expect(frame.nodes[0]?.translation).toEqual([3, 0, 0]);
    expect(last('uniformMatrix4fv', 'u_model')).toEqual(Array.from(new Float32Array(world)));
    expect(last('uniformMatrix3fv', 'u_normalMatrix')).toEqual(Array.from(new Float32Array(mat4NormalMatrix(world))));
    renderer.dispose();
  });

  it('decodes again when the textures change', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    const doc = animatedQuad();
    await renderer.setScene(doc);
    await renderer.setScene({ ...doc, textures: [testTexture()] });
    expect(decode).toHaveBeenCalledTimes(2);
    expect(fake.count(...READBACKS)).toBe(2);
    renderer.dispose();
  });

  it('supersedes a pending load, like any later call', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    const doc = animatedQuad();
    await renderer.setScene(doc);
    const pending = renderer.setScene({ ...doc, textures: [testTexture()] });
    const posed = renderer.setScene(animateScene(doc, { animation: 0, time: 0.5 }).document);
    expect((await posed).applied).toBe(true);
    expect((await pending).applied).toBe(false);
    expect(fake.count(...READBACKS)).toBe(1);
    renderer.dispose();
  });

  it('keeps a pose set while the context is lost and uploads the newest one on restore', async () => {
    const renderer = RealtimeRenderer.create(fake.canvas);
    renderer.setCamera(camera);
    const doc = animatedQuad();
    await renderer.setScene(doc);
    fake.fire('webglcontextlost');
    const frame = animateScene(doc, { animation: 0, time: 0.5 }).document;
    expect(await renderer.setScene(frame)).toEqual({ applied: true, warnings: [] });
    expect(decode).toHaveBeenCalledTimes(1);

    fake.fire('webglcontextrestored');
    const world = worldMatrices(frame.nodes)[0] ?? mat4Identity();
    const call = fake
      .calls('uniformMatrix4fv')
      .findLast(([location]) => (location as { name: string }).name === 'u_model');
    expect(Array.from((call?.[2] as Float32Array | undefined) ?? [])).toEqual(Array.from(new Float32Array(world)));
    expect(decode).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });
});

describe('RealtimeRenderer exact-key frames on the float path: progressive rotated-grid samples', () => {
  /** Inside the bounding sphere's depth range (near = far × 1e-4): exact. */
  const inside: SceneCamera = { ...camera, near: 0.001, far: 10 };
  const framed: SceneCamera = { ...camera, near: 1, far: 10 };
  const float = { samples: 4, maxSize: 4096 };

  beforeEach(() => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 16, height: 16, close: () => undefined })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The array textures given storage, with their size (each `texStorage3D` goes to the array bound last). */
  const histories = (fake: FakeWebGl): { texture: unknown; size: unknown[] }[] => {
    let bound: unknown = null;
    const found: { texture: unknown; size: unknown[] }[] = [];
    for (const [name, args] of fake.history()) {
      if (name === 'bindTexture' && args[0] === fake.gl.TEXTURE_2D_ARRAY) bound = args[1];
      if (name === 'texStorage3D') found.push({ texture: bound, size: args.slice(2) });
    }
    return found;
  };
  const deleted = (fake: FakeWebGl, texture: unknown): boolean =>
    fake.calls('deleteTexture').some(([t]) => t === texture);
  const lastUniform = (fake: FakeWebGl, method: string, uniform: string): unknown[] =>
    fake
      .calls(method)
      .findLast(([location]) => (location as { name: string } | null)?.name === uniform)
      ?.slice(1) ?? [];
  const uniformCalls = (fake: FakeWebGl, method: string, uniform: string): number =>
    fake.calls(method).filter(([location]) => (location as { name: string } | null)?.name === uniform).length;
  const lastLayer = (fake: FakeWebGl): unknown => fake.calls('framebufferTextureLayer').at(-1)?.[4];

  async function setUp(
    cameraOf: SceneCamera,
    options: { maxMsaaSamples?: number; rejects?: (width: number, height: number, layers: number) => boolean } = {},
  ): Promise<{ fake: FakeWebGl; renderer: RealtimeRenderer }> {
    const fake = fakeWebGl({ float: { ...float, ...(options.rejects ? { rejects: options.rejects } : {}) } });
    const renderer = RealtimeRenderer.create(
      fake.canvas,
      options.maxMsaaSamples !== undefined ? { maxMsaaSamples: options.maxMsaaSamples } : {},
    );
    renderer.setCamera(cameraOf);
    await renderer.setScene(quadScene());
    return { fake, renderer };
  }

  /** `u_viewProjection` of `cam` on a 64 × 64 canvas, shifted by `offset` pixels. */
  const viewProjection = (cam: SceneCamera, offset: readonly [number, number]): number[] => {
    const shift = new Float64Array([
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      (2 * offset[0]) / 64,
      (2 * offset[1]) / 64,
      0,
      1,
    ]);
    const projection = cameraProjection(cam, 1);
    const shifted = offset[0] === 0 && offset[1] === 0 ? projection : mat4Multiply(shift, projection);
    return Array.from(new Float32Array(mat4Multiply(shifted, cameraView(cam))));
  };

  it('draws one shifted pass per render into the next of 4 layers and presents the mean of the filled ones', async () => {
    const { fake, renderer } = await setUp(inside);
    expect(renderer.capabilities?.path).toBe('float');
    const single = await setUp(inside, { maxMsaaSamples: 0 });
    single.renderer.render();
    const singleDraws = single.fake.count('drawElements', 'drawArrays');
    single.renderer.dispose();
    for (let pass = 0; pass < 4; pass++) {
      const draws = fake.count('drawElements', 'drawArrays');
      renderer.render();
      expect(renderer.depthKeyMode).toBe('exact');
      expect(lastLayer(fake), `pass ${pass}`).toBe(pass);
      expect(lastUniform(fake, 'uniform1i', 'u_sampleCount'), `pass ${pass}`).toEqual([pass + 1]);
      expect(Array.from(lastUniform(fake, 'uniformMatrix4fv', 'u_viewProjection')[1] as Float32Array)).toEqual(
        viewProjection(inside, EXACT_SAMPLE_OFFSETS[pass] ?? [0, 0]),
      );
      expect(renderer.needsRender, `after pass ${pass}`).toBe(pass < 3);
      // One pass a call: the draws of the single-sampled frame.
      expect(fake.count('drawElements', 'drawArrays') - draws, `pass ${pass}`).toBe(singleDraws);
    }
    // RGBA16F, 64 × 64, 4 layers, allocated once.
    expect(histories(fake).map(({ size }) => size)).toEqual([[fake.gl.RGBA16F, 64, 64, 4]]);
    // A further call draws a pass again (into layer 0, with its offset): the same mean of 4.
    renderer.render();
    expect(lastLayer(fake)).toBe(0);
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([4]);
    expect(renderer.needsRender).toBe(false);
    renderer.dispose();
  });

  it('keeps the history for an equal camera and starts it again on a change or a resize', async () => {
    const { fake, renderer } = await setUp(inside);
    for (let pass = 0; pass < 4; pass++) renderer.render();
    renderer.setCamera({ ...inside, position: [0, 0, 5], up: [0, 1, 0] });
    expect(renderer.needsRender).toBe(false);

    renderer.setCamera({ ...inside, position: [0, 0, 4] });
    expect(renderer.needsRender).toBe(true);
    renderer.render();
    expect(lastLayer(fake)).toBe(0);
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);

    const before = histories(fake)[0]?.texture;
    renderer.resize({ cssWidth: 80, cssHeight: 64, devicePixelRatio: 1 });
    renderer.render();
    expect(histories(fake).map(({ size }) => size)).toEqual([
      [fake.gl.RGBA16F, 64, 64, 4],
      [fake.gl.RGBA16F, 80, 64, 4],
    ]);
    expect(deleted(fake, before)).toBe(true);
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);
    renderer.dispose();
  });

  it('flags a redraw for a camera that cannot be framed instead of throwing', async () => {
    const { renderer } = await setUp(inside);
    for (let pass = 0; pass < 4; pass++) renderer.render();
    expect(renderer.needsRender).toBe(false);
    const bad: SceneCamera[] = [
      { ...inside, projection: { kind: 'perspective', fovYDeg: 0 } },
      { ...inside, projection: { kind: 'orthographic', height: -1 } },
      { ...inside, near: 5, far: 1 },
      { ...inside, target: inside.position },
    ];
    for (const cam of bad) {
      renderer.setCamera(inside);
      renderer.render();
      expect(() => renderer.setCamera(cam)).not.toThrow();
      expect(renderer.needsRender).toBe(true);
    }
    renderer.dispose();
  });

  it('starts the history again on a pose, a look, and a lighting change, and keeps it across upload bands', async () => {
    const { fake, renderer } = await setUp(inside);
    const samples = (): unknown => lastUniform(fake, 'uniform1i', 'u_sampleCount')[0];
    const fill = (): void => {
      for (let pass = 0; pass < 4; pass++) renderer.render();
      expect(samples()).toBe(4);
    };

    fill();
    const doc = quadScene();
    const node = doc.nodes[0];
    if (!node) throw new Error('no node');
    expect((await renderer.setScene({ ...doc, nodes: [{ ...node, translation: [1, 0, 0] }] })).applied).toBe(true);
    renderer.render();
    expect(samples()).toBe(1);

    fill();
    renderer.setLook({ ...DEFAULT_LOOK, id: 'warm', backdrop: { top: [0.3, 0.2, 0.1], bottom: [0.1, 0.1, 0.1] } });
    renderer.render();
    expect(samples()).toBe(1);

    fill();
    const layout = renderer.lightmapLayout;
    if (!layout) throw new Error('no scene');
    const side = 512;
    const lighting: BakedLighting = {
      layoutKey: layout.layoutKey,
      lightingKey: lightingKey(renderer.look),
      width: layout.width,
      height: layout.height,
      data: new Uint16Array(layout.width * layout.height * 4).fill(0x3c00),
      samples: 1,
      catcher: { y: 0, rect: [0, 0, 1, 1], width: side, height: side, data: new Uint16Array(side * side * 4) },
    };
    expect(renderer.setLighting(lighting)).toBe(true);
    // The set restarts the history; the bands of the upload write textures frames do not draw, so they keep it;
    // the call that completes the upload switches the light and restarts it.
    const counts: unknown[] = [];
    for (let call = 0; call < 8 && (call === 0 || renderer.lightingPending); call++) {
      renderer.render();
      counts.push(samples());
    }
    expect(renderer.lightingPending).toBe(false);
    expect(counts).toEqual([1, 2, 1]);
    renderer.dispose();
  });

  it('starts again after a raster frame and after a look change', async () => {
    const { fake, renderer } = await setUp(inside);
    for (let pass = 0; pass < 4; pass++) renderer.render();
    renderer.setCamera(framed);
    renderer.render();
    expect(renderer.depthKeyMode).toBe('raster');
    renderer.setCamera(inside);
    renderer.render();
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);
    for (let pass = 1; pass < 4; pass++) renderer.render();
    renderer.setEdges({ width: 0.25 });
    renderer.render();
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);
    renderer.dispose();
  });

  it('draws a raster frame once at the pixel centre and never allocates a history', async () => {
    const { fake, renderer } = await setUp(framed);
    renderer.render();
    expect(renderer.depthKeyMode).toBe('raster');
    expect(renderer.needsRender).toBe(false);
    expect(histories(fake)).toEqual([]);
    expect(uniformCalls(fake, 'uniform1i', 'u_sampleCount')).toBe(0);
    expect(uniformCalls(fake, 'uniform1i', 'u_hdr')).toBe(1);
    expect(Array.from(lastUniform(fake, 'uniformMatrix4fv', 'u_viewProjection')[1] as Float32Array)).toEqual(
      viewProjection(framed, [0, 0]),
    );
    renderer.dispose();
  });

  it('draws exact frames once at the pixel centre without MSAA', async () => {
    const { fake, renderer } = await setUp(inside, { maxMsaaSamples: 0 });
    renderer.render();
    expect(renderer.depthKeyMode).toBe('exact');
    expect(renderer.needsRender).toBe(false);
    expect(histories(fake)).toEqual([]);
    expect(uniformCalls(fake, 'uniform1i', 'u_hdr')).toBe(1);
    expect(Array.from(lastUniform(fake, 'uniformMatrix4fv', 'u_viewProjection')[1] as Float32Array)).toEqual(
      viewProjection(inside, [0, 0]),
    );
    renderer.dispose();
  });

  it('keeps the float path single-sampled when the driver rejects the history, and does not retry that size', async () => {
    const { fake, renderer } = await setUp(inside, {
      rejects: (width, _height, layers) => layers === 4 && width === 64,
    });
    renderer.render();
    renderer.render();
    expect(renderer.capabilities?.path).toBe('float');
    const rejected = histories(fake);
    expect(rejected).toHaveLength(1);
    expect(deleted(fake, rejected[0]?.texture)).toBe(true);
    expect(renderer.needsRender).toBe(false);
    expect(uniformCalls(fake, 'uniform1i', 'u_sampleCount')).toBe(0);

    // Another size is tried again.
    fake.canvas.width = 80;
    renderer.render();
    expect(histories(fake)).toHaveLength(2);
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);
    renderer.dispose();
  });

  it('frees the history when the size no longer takes one, on dispose and on a switch to the no-float path', async () => {
    const oversize = await setUp(inside);
    oversize.renderer.render();
    const first = histories(oversize.fake)[0]?.texture;
    // 4 slots of 2049 × 1024 are over 2^23 pixels.
    oversize.fake.canvas.width = 2049;
    oversize.fake.canvas.height = 1024;
    oversize.renderer.render();
    expect(deleted(oversize.fake, first)).toBe(true);
    expect(histories(oversize.fake)).toHaveLength(1);
    expect(oversize.renderer.needsRender).toBe(false);
    oversize.renderer.dispose();

    const disposed = await setUp(inside);
    disposed.renderer.render();
    const texture = histories(disposed.fake)[0]?.texture;
    disposed.renderer.dispose();
    expect(deleted(disposed.fake, texture)).toBe(true);

    const switched = await setUp(inside, { rejects: (width, _height, layers) => layers === 1 && width === 80 });
    switched.renderer.render();
    const before = histories(switched.fake)[0]?.texture;
    switched.fake.canvas.width = 80;
    switched.renderer.render();
    expect(switched.renderer.capabilities?.path).toBe('fallback');
    expect(deleted(switched.fake, before)).toBe(true);
    switched.renderer.dispose();
  });

  it('allocates a new history after a context restore without deleting the dead one', async () => {
    const { fake, renderer } = await setUp(inside);
    renderer.render();
    const dead = histories(fake)[0]?.texture;
    fake.fire('webglcontextlost');
    expect(renderer.needsRender).toBe(false);
    fake.fire('webglcontextrestored');
    expect(histories(fake)).toHaveLength(2);
    expect(deleted(fake, dead)).toBe(false);
    expect(lastUniform(fake, 'uniform1i', 'u_sampleCount')).toEqual([1]);
    expect(renderer.needsRender).toBe(true);
    renderer.dispose();
  });
});
