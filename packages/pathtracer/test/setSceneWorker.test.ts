import { MAX_EDGE_WIDTH } from '@modelshot/looks';
import type { SceneDocument } from '@modelshot/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareGeometry } from '../src/geometry/prepareGeometry';
import { PathTracer } from '../src/PathTracer';
import type { PathTracerOptions, SetSceneResult } from '../src/PathTracerOptions';
import { FakeGeometryWorker, until } from './fakeGeometryWorker';
import { stubGl, type GlCall } from './stubGl';
import { boxMesh, randomTriangles, sceneOf, triangleMesh } from './testScenes';

interface Loaded {
  readonly doc: SceneDocument;
  readonly edgeAngle: number;
  readonly geometry: { readonly triAttributes: { readonly data: Float32Array } };
}

/** A tracer on a recording stub context, its GPU setup (programs, targets) stubbed out, its worker a fake one. */
function tracer(options: PathTracerOptions = {}, onCall?: (call: GlCall) => void) {
  vi.stubGlobal('Worker', FakeGeometryWorker);
  const { gl, calls } = stubGl(onCall ? { onCall } : {});
  const canvas = {
    width: 4,
    height: 4,
    getContext: () => gl,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLCanvasElement;
  vi.spyOn(PathTracer.prototype as unknown as { createGpu: () => unknown }, 'createGpu').mockImplementation(() => ({
    capabilities: { maxTextureSize: 4096, maxArrayTextureLayers: 256, layerSide: 4096, renderer: 'stub' },
    programs: { dispose: () => undefined },
    vao: {},
    scene: null,
    targets: null,
    resolve: null,
    targetLimits: { maxWidth: 4096, maxHeight: 4096 },
  }));
  const created = PathTracer.create(canvas, options);
  const worker = FakeGeometryWorker.last;
  if (!worker || !created.geometryInWorker) throw new Error('no fake worker');
  const internals = created as unknown as { loaded: Loaded | null; gpu: { scene: unknown } | null };
  return { tracer: created, worker, gl, calls, internals };
}

const scene = (seed: number): SceneDocument => sceneOf([triangleMesh(randomTriangles(50, seed))]);
const applied = (result: Promise<SetSceneResult>) => result.then((r) => r.applied);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('setScene with the geometry worker', () => {
  it('a scene over maxTriangles rejects before anything is posted; the pending call still applies', async () => {
    const { tracer: pt, worker, internals } = tracer({ maxTriangles: 60 });
    const first = scene(1);
    const pending = applied(pt.setScene(first));
    const tooLarge = sceneOf([triangleMesh(randomTriangles(61, 2))]);
    await expect(pt.setScene(tooLarge)).rejects.toMatchObject({ code: 'SCENE_TOO_LARGE' });
    expect(await pending).toBe(true);
    expect(internals.loaded?.doc).toBe(first);
    // Only the first call's mesh and request reached the worker.
    expect(worker.ofType('prepare')).toHaveLength(1);
    expect(worker.ofType('meshHeaders').flatMap((m) => m.headers)).toHaveLength(1);
  });

  it('of two valid calls the earlier is superseded even when its geometry and upload finish first', async () => {
    const { tracer: pt, worker, internals } = tracer();
    worker.holdReplies = true;
    const a = scene(3);
    const b = scene(4);
    const first = applied(pt.setScene(a));
    const second = applied(pt.setScene(b));
    await until(() => worker.held.length === 2);
    // A's geometry first: it decodes and uploads, then waits for B's build before it may swap.
    worker.release(worker.held.slice(0, 1));
    let firstDone = false;
    void first.then(() => (firstDone = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(firstDone).toBe(false);
    worker.release();
    expect([await first, await second]).toEqual([false, true]);
    expect(internals.loaded?.doc).toBe(b);
  });

  it('a later call the worker rejects for a limit supersedes nothing', async () => {
    const { tracer: pt, worker, internals } = tracer();
    worker.holdReplies = true;
    const a = scene(5);
    const first = applied(pt.setScene(a));
    const second = pt.setScene(scene(6));
    await until(() => worker.held.length === 2);
    const rejected = worker.held[1];
    if (rejected?.type !== 'prepared') throw new Error('no reply');
    worker.release([
      worker.held[0] as (typeof worker.held)[0],
      { type: 'error', id: rejected.id, name: 'PathTracerError', code: 'SCENE_TOO_LARGE', message: 'rows', path: '' },
    ]);
    await expect(second).rejects.toMatchObject({ code: 'SCENE_TOO_LARGE', message: 'rows' });
    expect(await first).toBe(true);
    expect(internals.loaded?.doc).toBe(a);
  });

  it('a sharp angle set while the geometry is built is packed at the swap, as inline', async () => {
    const { tracer: pt, worker, internals } = tracer({ edges: { sharpAngleDeg: 30 } });
    const doc = sceneOf([boxMesh([0, 0, 0], [1, 1, 1])]);
    const pending = pt.setScene(doc);
    pt.setEdges({ sharpAngleDeg: 60 });
    expect((await pending).applied).toBe(true);
    // Built in the worker at 30 degrees, repacked for 60.
    expect(worker.ofType('prepare')[0]?.params.edges.sharpAngleDeg).toBe(30);
    expect(internals.loaded?.edgeAngle).toBe(60);
    const expected = prepareGeometry(doc, {
      maxTriangles: 200_000,
      edges: { sharpAngleDeg: 60, reach: MAX_EDGE_WIDTH },
      maxTextureSize: 4096,
      sceneBounds: true,
    });
    expect(internals.loaded?.geometry.triAttributes.data).toEqual(expected.geometry.triAttributes.data);
  });

  it('the new scene uploads in bands while the current one stays; a superseded upload frees its textures', async () => {
    let watch: (() => void) | null = null;
    const {
      tracer: pt,
      calls,
      internals,
    } = tracer({}, (call) => {
      if (call.name === 'texSubImage2D') watch?.();
    });
    expect((await pt.setScene(scene(7))).applied).toBe(true);
    const current = internals.gpu?.scene;
    expect(current).toBeTruthy();
    // Every band of the next scene is written while the current scene is the one drawn.
    const drawnDuringBands: unknown[] = [];
    watch = () => drawnDuringBands.push(internals.gpu?.scene);
    expect(await applied(pt.setScene(scene(8)))).toBe(true);
    expect(drawnDuringBands).toHaveLength(4);
    expect(drawnDuringBands.every((drawn) => drawn === current)).toBe(true);
    expect(internals.gpu?.scene).not.toBe(current);

    const replaced = internals.gpu?.scene;
    const before = calls.length;
    // The next call comes while the first band of this one is written.
    const second: { applied?: Promise<boolean> } = {};
    watch = () => {
      second.applied ??= applied(pt.setScene(scene(10)));
    };
    const first = applied(pt.setScene(scene(9)));
    expect(await first).toBe(false);
    expect(await second.applied).toBe(true);
    expect(internals.gpu?.scene).not.toBe(replaced);
    // The superseded upload's five textures and the replaced scene's five.
    expect(calls.slice(before).filter((c) => c.name === 'deleteTexture')).toHaveLength(10);
  });

  it('dispose during a pending setScene resolves it unapplied and terminates the worker', async () => {
    const { tracer: pt, worker, internals } = tracer();
    worker.holdReplies = true;
    const pending = pt.setScene(scene(10));
    await until(() => worker.held.length === 1);
    pt.dispose();
    expect(await pending).toEqual({ applied: false, warnings: [], triangles: 0 });
    expect(worker.terminated).toBe(true);
    worker.release();
    expect(internals.loaded).toBeNull();
  });

  it('builds on the main thread with geometryWorker false', async () => {
    vi.stubGlobal('Worker', FakeGeometryWorker);
    FakeGeometryWorker.last = null;
    const { gl } = stubGl();
    const canvas = {
      width: 4,
      height: 4,
      getContext: () => gl,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(PathTracer.prototype as unknown as { createGpu: () => unknown }, 'createGpu').mockReturnValue(null);
    const inline = PathTracer.create(canvas, { geometryWorker: false });
    expect(inline.geometryInWorker).toBe(false);
    expect(FakeGeometryWorker.last).toBeNull();
    expect((await inline.setScene(scene(11))).triangles).toBe(50);
  });
});
