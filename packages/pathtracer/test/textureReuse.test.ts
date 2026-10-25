import { MAX_EDGE_WIDTH } from '@modelshot/looks';
import type { SceneDocument, SceneMesh, SceneTexture } from '@modelshot/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareGeometry } from '../src/geometry/prepareGeometry';
import { PathTracer } from '../src/PathTracer';
import type { PathTracerOptions } from '../src/PathTracerOptions';
import { FakeGeometryWorker, until } from './fakeGeometryWorker';
import { stubGl, type GlCall } from './stubGl';
import { boxMesh, node, randomTriangles, sceneOf, triangleMesh } from './testScenes';

interface Loaded {
  readonly doc: SceneDocument;
  readonly bitmaps: readonly (ImageBitmap | null)[];
  readonly geometry: {
    readonly nodes: { readonly data: Float32Array };
    readonly triPositions: { readonly data: Float32Array };
    readonly triAttributes: { readonly data: Float32Array };
  };
  readonly materials: { readonly data: Float32Array };
}

interface SceneHandles {
  readonly nodes: unknown;
  readonly triPositions: unknown;
  readonly triAttributes: unknown;
  readonly materials: unknown;
  readonly layers: unknown;
}

type Internals = {
  loaded: Loaded | null;
  gpu: { scene: SceneHandles | null } | null;
  handleContextLost: (event: Event) => void;
  handleContextRestored: () => void;
};

/** The signature and IHDR of a 2 x 2 PNG: all `planTextureDecode` reads; the decoder is a stub. */
const PNG_2X2 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2,
]);

const texture = (name: string): SceneTexture => ({
  name,
  mimeType: 'image/png',
  bytes: PNG_2X2,
  width: 2,
  height: 2,
  uvWidth: 16,
  uvHeight: 16,
  missing: false,
});

/** A tracer on a recording stub context, its GPU setup stubbed out, its worker a fake one; textures decode to stubs. */
function tracer(options: PathTracerOptions = {}, onCall?: (call: GlCall) => void) {
  vi.stubGlobal('Worker', FakeGeometryWorker);
  const closed: number[] = [];
  const closes: number[] = [];
  let made = 0;
  const decode = vi.fn((blob: Blob) => {
    if (blob.size !== PNG_2X2.length) return Promise.reject(new Error('bad'));
    const id = made++;
    const bitmap = {
      width: 2,
      height: 2,
      close: () => {
        closed.push(closed.length);
        closes[id] = (closes[id] ?? 0) + 1;
      },
    };
    return Promise.resolve(bitmap as unknown as ImageBitmap);
  });
  vi.stubGlobal('createImageBitmap', decode);
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
  return { tracer: created, worker, gl, calls, decode, closed, closes, internals: created as unknown as Internals };
}

/** One textured box on a node that a pose moves; the texture array and the material array are shared by every pose. */
function rest(textures: SceneTexture[] = [texture('atlas')]): SceneDocument {
  const doc = sceneOf(
    [boxMesh([0, 0, 0], [1, 1, 1], { node: 0 }), triangleMesh(randomTriangles(30, 5), { node: 0 })],
    [node({ meshes: [0, 1] })],
  );
  return { ...doc, materials: [{ name: 'm', texture: 0 }], textures };
}

/** The document at pose `t`: new nodes, the same meshes, materials and textures (what `animateScene` returns). */
function pose(doc: SceneDocument, t: number): SceneDocument {
  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, translation: [t, 0.5 * t, 0] as [number, number, number] })) };
}

const count = (calls: readonly GlCall[], name: string, from = 0) =>
  calls.slice(from).filter((c) => c.name === name).length;
const deletedSince = (calls: readonly GlCall[], from: number) =>
  new Set(
    calls
      .slice(from)
      .filter((c) => c.name === 'deleteTexture')
      .map((c) => c.args[0]),
  );
const handles = (scene: SceneHandles | null | undefined) =>
  scene ? [scene.nodes, scene.triPositions, scene.triAttributes, scene.materials, scene.layers] : [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('setScene with the textures of the shown scene', () => {
  it('consecutive poses decode and upload the textures once', async () => {
    const { tracer: pt, calls, decode, internals } = tracer();
    const doc = rest();
    const first = await pt.setScene(doc);
    expect(first.applied).toBe(true);
    const layers = internals.gpu?.scene?.layers;
    const materials = internals.gpu?.scene?.materials;
    const at = calls.length;
    for (const t of [1, 2]) {
      const result = await pt.setScene(pose(doc, t));
      expect(result.applied).toBe(true);
      expect(result.triangles).toBe(first.triangles);
    }
    expect(decode).toHaveBeenCalledTimes(1);
    expect(count(calls, 'texStorage3D', at)).toBe(0);
    expect(count(calls, 'texSubImage3D', at)).toBe(0);
    expect(internals.gpu?.scene?.layers).toBe(layers);
    expect(internals.gpu?.scene?.materials).toBe(materials);
    // Only the three geometry textures of each replaced scene are deleted.
    expect(deletedSince(calls, at).size).toBe(6);
    expect(handles(internals.gpu?.scene).some((h) => deletedSince(calls, at).has(h))).toBe(false);
  });

  it('the data of a pose equals that of a fresh tracer doing a full setScene of it', async () => {
    const a = tracer();
    const doc = rest();
    await a.tracer.setScene(doc);
    await a.tracer.setScene(pose(doc, 1));
    await a.tracer.setScene(pose(doc, 2));
    const reused = a.internals.loaded;
    a.tracer.dispose();
    vi.restoreAllMocks();

    const b = tracer();
    await b.tracer.setScene(pose(rest(), 2));
    const fresh = b.internals.loaded;
    for (const key of ['nodes', 'triPositions', 'triAttributes'] as const) {
      expect(reused?.geometry[key].data, key).toEqual(fresh?.geometry[key].data);
    }
    expect(reused?.materials.data).toEqual(fresh?.materials.data);
  });

  it('a new textures array with the same contents decodes and uploads again', async () => {
    const { tracer: pt, calls, decode } = tracer();
    await pt.setScene(rest());
    const at = calls.length;
    await pt.setScene(rest());
    expect(decode).toHaveBeenCalledTimes(2);
    expect(count(calls, 'texStorage3D', at)).toBe(1);
    expect(count(calls, 'texSubImage3D', at)).toBeGreaterThan(0);
  });

  it('the same textures with a new materials array or other emission keep the layers and pack a new table', async () => {
    const { tracer: pt, calls, decode, internals } = tracer();
    const doc = rest();
    await pt.setScene(doc, { emission: [[1, 0, 0]] });
    const layers = internals.gpu?.scene?.layers;
    const materials = internals.gpu?.scene?.materials;

    await pt.setScene(pose(doc, 1), { emission: [[1, 0, 0]] });
    expect(internals.gpu?.scene?.materials).toBe(materials);

    let at = calls.length;
    await pt.setScene(pose(doc, 1), { emission: [[0, 1, 0]] });
    expect(internals.gpu?.scene?.layers).toBe(layers);
    expect(internals.gpu?.scene?.materials).not.toBe(materials);
    expect(count(calls, 'texSubImage3D', at)).toBe(0);
    expect(internals.loaded?.materials.data.slice(20, 23)).toEqual(new Float32Array([0, 1, 0]));

    const other = { ...doc, materials: [{ name: 'other', texture: 0 }] };
    at = calls.length;
    await pt.setScene(other, { emission: [[0, 1, 0]] });
    expect(internals.gpu?.scene?.layers).toBe(layers);
    expect(count(calls, 'texStorage3D', at)).toBe(0);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('a number or string emission entry counts as no glow, and a table with entries that are no arrays never matches for reuse', async () => {
    const { tracer: pt, internals } = tracer();
    const doc = rest();
    const hostile = [5, 'abc', { 0: 1 }] as unknown as [number, number, number][];
    expect((await pt.setScene(doc, { emission: hostile })).applied).toBe(true);
    expect(internals.loaded?.materials.data.slice(20, 23)).toEqual(new Float32Array([0, 0, 0]));
    const materials = internals.gpu?.scene?.materials;
    expect((await pt.setScene(pose(doc, 1), { emission: hostile })).applied).toBe(true);
    expect(internals.gpu?.scene?.materials).not.toBe(materials);
    await pt.setScene(doc, { emission: [[1, 0, 0]] });
    const red = internals.gpu?.scene?.materials;
    await pt.setScene(pose(doc, 1), { emission: [[1, 0, 0]] });
    expect(internals.gpu?.scene?.materials).toBe(red);
  });

  it('a superseded reusing call and one rejected for a limit leave the shown images and textures alone', async () => {
    const { tracer: pt, worker, calls, closed, internals } = tracer({ maxTriangles: 100 });
    const doc = rest();
    await pt.setScene(doc);
    const layers = internals.gpu?.scene?.layers;
    const at = calls.length;

    worker.holdReplies = true;
    const a = pt.setScene(pose(doc, 1));
    const b = pt.setScene(pose(doc, 2));
    await until(() => worker.held.length === 2);
    worker.release();
    expect([(await a).applied, (await b).applied]).toEqual([false, true]);
    expect(closed).toHaveLength(0);
    expect(internals.gpu?.scene?.layers).toBe(layers);
    expect(deletedSince(calls, at).has(layers)).toBe(false);

    const c = pt.setScene(pose(doc, 3));
    const tooLarge = pt.setScene({
      ...doc,
      meshes: [doc.meshes[0] as SceneMesh, triangleMesh(randomTriangles(101, 1), { node: 0 })],
    });
    await expect(tooLarge).rejects.toMatchObject({ code: 'SCENE_TOO_LARGE' });
    await until(() => worker.held.length === 1);
    worker.release();
    expect((await c).applied).toBe(true);
    expect(closed).toHaveLength(0);
    expect(internals.gpu?.scene?.layers).toBe(layers);
    expect(deletedSince(calls, at).has(layers)).toBe(false);
  });

  it('setEdges while a reusing call uploads: the swap falls back and the data is that of a fresh render', async () => {
    let edit: (() => void) | null = null;
    const {
      tracer: pt,
      calls,
      closed,
      internals,
    } = tracer({ edges: { sharpAngleDeg: 30 } }, (call) => {
      if (call.name === 'texSubImage2D') edit?.();
    });
    const doc = rest();
    await pt.setScene(doc);
    const at = calls.length;
    edit = () => {
      edit = null;
      pt.setEdges({ sharpAngleDeg: 60 });
    };
    const posed = pose(doc, 1);
    expect((await pt.setScene(posed)).applied).toBe(true);
    expect(closed).toHaveLength(0);
    const expected = prepareGeometry(posed, {
      maxTriangles: 200_000,
      edges: { sharpAngleDeg: 60, reach: MAX_EDGE_WIDTH },
      maxTextureSize: 4096,
      sceneBounds: true,
    });
    expect(internals.loaded?.geometry.triAttributes.data).toEqual(expected.geometry.triAttributes.data);
    const final = handles(internals.gpu?.scene);
    expect(final).toHaveLength(5);
    expect(final.some((h) => deletedSince(calls, at).has(h))).toBe(false);
    // The fallback uploaded the images into its own layer texture.
    expect(count(calls, 'texSubImage3D', at)).toBeGreaterThan(0);
  });

  it('a sharp angle changed and changed back during a reusing call: the borrowed layers are not swapped in', async () => {
    let edit: (() => void) | null = null;
    const {
      tracer: pt,
      calls,
      internals,
    } = tracer({ edges: { sharpAngleDeg: 30 } }, (call) => {
      if (call.name === 'texSubImage2D') edit?.();
    });
    const doc = rest();
    await pt.setScene(doc);
    const at = calls.length;
    edit = () => {
      edit = null;
      pt.setEdges({ sharpAngleDeg: 60 });
      pt.setEdges({ sharpAngleDeg: 30 });
    };
    const posed = pose(doc, 1);
    expect((await pt.setScene(posed)).applied).toBe(true);
    const expected = prepareGeometry(posed, {
      maxTriangles: 200_000,
      edges: { sharpAngleDeg: 30, reach: MAX_EDGE_WIDTH },
      maxTextureSize: 4096,
      sceneBounds: true,
    });
    expect(internals.loaded?.geometry.triAttributes.data).toEqual(expected.geometry.triAttributes.data);
    const final = handles(internals.gpu?.scene);
    expect(final.some((h) => deletedSince(calls, at).has(h))).toBe(false);
  });

  it('a context lost and restored during a reusing call uploads the scene fresh from what is kept', async () => {
    let lose: (() => void) | null = null;
    const {
      tracer: pt,
      calls,
      closed,
      internals,
    } = tracer({}, (call) => {
      if (call.name === 'texSubImage2D') lose?.();
    });
    const doc = rest();
    await pt.setScene(doc);
    const at = calls.length;
    lose = () => {
      lose = null;
      internals.handleContextLost({ preventDefault: () => undefined } as Event);
      internals.handleContextRestored();
    };
    const posed = pose(doc, 1);
    expect((await pt.setScene(posed)).applied).toBe(true);
    expect(internals.loaded?.doc).toBe(posed);
    expect(closed).toHaveLength(0);
    const final = handles(internals.gpu?.scene);
    expect(final).toHaveLength(5);
    expect(final.some((h) => deletedSince(calls, at).has(h))).toBe(false);
    // The restore and the swap's fallback each wrote the images.
    expect(count(calls, 'texStorage3D', at)).toBeGreaterThanOrEqual(2);
  });

  it('dispose during a reusing call resolves it unapplied and closes every image once', async () => {
    let dispose: (() => void) | null = null;
    const {
      tracer: pt,
      calls,
      closes,
      internals,
    } = tracer({}, (call) => {
      if (call.name === 'texSubImage2D') dispose?.();
    });
    const doc = rest([texture('a'), texture('b')]);
    await pt.setScene({ ...doc, textures: [...doc.textures] });
    await pt.setScene(doc);
    const layers = internals.gpu?.scene?.layers;
    dispose = () => {
      dispose = null;
      pt.dispose();
    };
    expect((await pt.setScene(pose(doc, 1))).applied).toBe(false);
    // The first scene's two images closed when the second replaced it, the second's two by dispose.
    expect(closes).toEqual([1, 1, 1, 1]);
    expect(calls.filter((c) => c.name === 'deleteTexture' && c.args[0] === layers)).toHaveLength(1);
  });

  it('a call that borrowed nothing keeps its upload when the sharp angle is changed and restored meanwhile', async () => {
    const run = async (disturb: boolean) => {
      let edit: (() => void) | null = null;
      const {
        tracer: pt,
        calls,
        internals,
      } = tracer({ edges: { sharpAngleDeg: 30 } }, (call) => {
        if (call.name === 'texSubImage2D') edit?.();
      });
      const doc = rest();
      await pt.setScene(doc);
      const at = calls.length;
      if (disturb) {
        edit = () => {
          edit = null;
          pt.setEdges({ sharpAngleDeg: 60 });
          pt.setEdges({ sharpAngleDeg: 30 });
        };
      }
      expect((await pt.setScene({ ...doc, textures: [...doc.textures] })).applied).toBe(true);
      return { images: count(calls, 'texStorage3D', at), data: internals.loaded?.geometry.triAttributes.data };
    };
    const calm = await run(false);
    const disturbed = await run(true);
    // Each setEdges uploads the shown scene again on its own; the call's own upload stays, with no fallback after it.
    expect(disturbed.images).toBe(calm.images + 2);
    expect(disturbed.data).toEqual(calm.data);
  });

  it('a reusing call reports the warnings of the first call', async () => {
    const bad: SceneTexture = { ...texture('bad'), bytes: new Uint8Array([1, 2, 3]) };
    const { tracer: pt } = tracer();
    const doc = rest([texture('ok'), bad]);
    const first = await pt.setScene(doc);
    expect(first.warnings.map((w) => w.code)).toEqual(['TEXTURE_DECODE_FAILED']);
    const second = await pt.setScene(pose(doc, 1));
    expect(second.warnings).toEqual(first.warnings);
    expect(second.applied).toBe(true);
  });
});
