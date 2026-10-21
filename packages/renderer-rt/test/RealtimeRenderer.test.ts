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
