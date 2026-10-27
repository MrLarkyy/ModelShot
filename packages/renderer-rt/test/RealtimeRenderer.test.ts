import {
  animateScene,
  mat4Identity,
  mat4NormalMatrix,
  worldMatrices,
  type SceneCamera,
  type SceneDocument,
} from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('RealtimeRenderer exact-key frames on the float path', () => {
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

  /** The textures given storage of `width` × `height` (each `texStorage2D` goes to the texture bound last). */
  const texturesOf = (fake: FakeWebGl, width: number, height: number): unknown[] => {
    let bound: unknown = null;
    const found: unknown[] = [];
    for (const [name, args] of fake.history()) {
      if (name === 'bindTexture') bound = args[1];
      if (name === 'texStorage2D' && args[3] === width && args[4] === height) found.push(bound);
    }
    return found;
  };
  const deleted = (fake: FakeWebGl, textures: readonly unknown[]): number =>
    fake.calls('deleteTexture').filter(([texture]) => textures.includes(texture)).length;
  const lastUniform = (fake: FakeWebGl, method: string, uniform: string): unknown[] =>
    fake
      .calls(method)
      .findLast(([location]) => (location as { name: string } | null)?.name === uniform)
      ?.slice(1) ?? [];

  async function setUp(
    cameraOf: SceneCamera,
    options: { maxMsaaSamples?: number; rejects?: (width: number, height: number) => boolean } = {},
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

  it('draws an exact frame into one 0-sample target of 2W × 2H and presents its 2 × 2 mean at W × H', async () => {
    const { fake, renderer } = await setUp(inside);
    expect(renderer.capabilities?.path).toBe('float');
    renderer.render();
    expect(renderer.depthKeyMode).toBe('exact');
    // hdr, accum and weight; one depth renderbuffer, no multisampled storage at that size.
    expect(texturesOf(fake, 128, 128)).toHaveLength(3);
    expect(fake.calls('renderbufferStorage').filter((args) => args[2] === 128 && args[3] === 128)).toHaveLength(1);
    expect(fake.calls('renderbufferStorageMultisample').filter((args) => args[3] === 128)).toHaveLength(0);
    expect(fake.calls('viewport')).toContainEqual([0, 0, 128, 128]);
    expect(fake.calls('viewport').at(-1)).toEqual([0, 0, 64, 64]);
    expect(lastUniform(fake, 'uniform2f', 'u_viewportSize')).toEqual([128, 128]);
    expect(lastUniform(fake, 'uniform1f', 'u_lookFrameHeight')).toEqual([64]);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([2]);

    // Another frame of the same size reallocates nothing.
    renderer.setCamera({ ...inside, position: [0, 0, 4] });
    renderer.render();
    expect(texturesOf(fake, 128, 128)).toHaveLength(3);
    renderer.dispose();
  });

  it('draws a raster frame at the canvas size and never allocates the 2 × 2 targets', async () => {
    const { fake, renderer } = await setUp(framed);
    renderer.render();
    expect(renderer.depthKeyMode).toBe('raster');
    expect(texturesOf(fake, 128, 128)).toHaveLength(0);
    expect(fake.calls('viewport').every((args) => args[2] === 64 && args[3] === 64)).toBe(true);
    expect(lastUniform(fake, 'uniform2f', 'u_viewportSize')).toEqual([64, 64]);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([1]);
    renderer.dispose();
  });

  it('draws exact frames single-sampled without MSAA', async () => {
    const { fake, renderer } = await setUp(inside, { maxMsaaSamples: 0 });
    renderer.render();
    expect(renderer.depthKeyMode).toBe('exact');
    expect(texturesOf(fake, 128, 128)).toHaveLength(0);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([1]);
    renderer.dispose();
  });

  it('keeps the float path single-sampled when the driver rejects the 2 × 2 size, and does not retry it', async () => {
    const { fake, renderer } = await setUp(inside, { rejects: (width) => width === 128 });
    renderer.render();
    renderer.render();
    expect(renderer.capabilities?.path).toBe('float');
    const rejected = texturesOf(fake, 128, 128);
    expect(rejected).toHaveLength(3);
    expect(deleted(fake, rejected)).toBe(3);
    expect(lastUniform(fake, 'uniform2f', 'u_viewportSize')).toEqual([64, 64]);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([1]);

    // Another size is tried again.
    fake.canvas.width = 80;
    renderer.render();
    expect(texturesOf(fake, 160, 128)).toHaveLength(3);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([2]);
    renderer.dispose();
  });

  it('reallocates once on resize and frees the targets when the size no longer fits', async () => {
    const { fake, renderer } = await setUp(inside);
    renderer.render();
    const first = texturesOf(fake, 128, 128);
    fake.canvas.width = 80;
    renderer.render();
    renderer.render();
    expect(texturesOf(fake, 160, 128)).toHaveLength(3);
    expect(deleted(fake, first)).toBe(3);

    // 2W over MAX_RENDERBUFFER_SIZE (4096): single-sampled, targets freed.
    const second = texturesOf(fake, 160, 128);
    fake.canvas.width = 2049;
    renderer.render();
    expect(deleted(fake, second)).toBe(3);
    expect(texturesOf(fake, 4098, 128)).toHaveLength(0);
    expect(lastUniform(fake, 'uniform1i', 'u_supersample')).toEqual([1]);
    renderer.dispose();
  });

  it('frees the targets on dispose and on a switch to the no-float path', async () => {
    const disposed = await setUp(inside);
    disposed.renderer.render();
    const targets = texturesOf(disposed.fake, 128, 128);
    disposed.renderer.dispose();
    expect(deleted(disposed.fake, targets)).toBe(3);

    const switched = await setUp(inside, { rejects: (width) => width === 80 });
    switched.renderer.render();
    const before = texturesOf(switched.fake, 128, 128);
    switched.fake.canvas.width = 80;
    switched.renderer.render();
    expect(switched.renderer.capabilities?.path).toBe('fallback');
    expect(deleted(switched.fake, before)).toBe(3);
    switched.renderer.dispose();
  });

  it('allocates new targets after a context restore without deleting the dead ones', async () => {
    const { fake, renderer } = await setUp(inside);
    renderer.render();
    const dead = texturesOf(fake, 128, 128);
    fake.fire('webglcontextlost');
    fake.fire('webglcontextrestored');
    expect(texturesOf(fake, 128, 128)).toHaveLength(6);
    expect(deleted(fake, dead)).toBe(0);
    renderer.dispose();
  });
});
