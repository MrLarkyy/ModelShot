import type { SceneDocument } from '@modelshot/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PathTracer } from '../src/PathTracer';
import type { PathTracerOptions } from '../src/PathTracerOptions';
import { FakeGeometryWorker } from './fakeGeometryWorker';
import { dataTextureRecorder, stubGl, type GlCall } from './stubGl';
import { boxMesh, node, randomTriangles, sceneOf, triangleMesh } from './testScenes';

interface Scene {
  nodes: unknown;
  triPositions: unknown;
  triAttributes: unknown;
  materials: unknown;
  layers: unknown;
}
interface Internals {
  loaded: { geometry: { triAttributes: { rows: number; data: Float32Array } } } | null;
  gpu: { scene: Scene | null } | null;
  handleContextLost: (event: Event) => void;
  handleContextRestored: () => void;
}

function make(options: PathTracerOptions) {
  vi.stubGlobal('Worker', FakeGeometryWorker);
  const recorder = dataTextureRecorder();
  const { gl, calls } = stubGl({ onCall: recorder.onCall });
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
  const tracer = PathTracer.create(canvas, options);
  return { tracer, calls, recorder, internals: tracer as unknown as Internals };
}

const doc = (): SceneDocument =>
  sceneOf(
    [boxMesh([0, 0, 0], [1, 1, 1], { node: 0 }), triangleMesh(randomTriangles(400, 5), { node: 0 })],
    [node({ meshes: [0, 1] })],
  );
const count = (calls: readonly GlCall[], name: string, from = 0) =>
  calls.slice(from).filter((c) => c.name === name).length;
const handlesOf = (s: Scene | null | undefined) =>
  s ? [s.nodes, s.triPositions, s.triAttributes, s.materials, s.layers] : [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PathTracer.setEdges', () => {
  it('a new sharp angle rewrites the attribute rows in place and touches nothing else', async () => {
    const { tracer, calls, internals } = make({ edges: { sharpAngleDeg: 30 } });
    await tracer.setScene(doc());
    const before = handlesOf(internals.gpu?.scene);
    const at = calls.length;
    tracer.setEdges({ sharpAngleDeg: 60 });
    const written = calls.slice(at).filter((c) => c.name === 'texSubImage2D');
    expect(written).toHaveLength(1);
    expect(written[0]?.args[3]).toBe(0);
    expect(written[0]?.args[5]).toBe(internals.loaded?.geometry.triAttributes.rows);
    const bind = calls.slice(at).find((c) => c.name === 'bindTexture');
    expect(bind?.args[1]).toBe(internals.gpu?.scene?.triAttributes);
    for (const name of [
      'texStorage2D',
      'texStorage3D',
      'texSubImage3D',
      'texImage2D',
      'createTexture',
      'deleteTexture',
    ]) {
      expect(count(calls, name, at)).toBe(0);
    }
    expect(handlesOf(internals.gpu?.scene).every((h, i) => h === before[i])).toBe(true);
  });

  it('the GPU data equals that of a tracer that loaded the scene at the new angle', async () => {
    const a = make({ edges: { sharpAngleDeg: 30 } });
    await a.tracer.setScene(doc());
    const layerWrites = count(a.calls, 'texSubImage3D');
    a.tracer.setEdges({ sharpAngleDeg: 60 });
    expect(count(a.calls, 'texSubImage3D')).toBe(layerWrites);
    const shownA = a.internals.gpu?.scene;
    const cpuA = a.internals.loaded?.geometry.triAttributes.data.slice();
    a.tracer.dispose();
    vi.restoreAllMocks();
    const b = make({ edges: { sharpAngleDeg: 60 } });
    await b.tracer.setScene(doc());
    const shownB = b.internals.gpu?.scene;
    expect(b.internals.loaded?.geometry.triAttributes.data).toEqual(cpuA);
    for (const key of ['nodes', 'triPositions', 'triAttributes', 'materials'] as const) {
      const recorded = a.recorder.contents.get(shownA?.[key]);
      expect(recorded).toBeDefined();
      expect(recorded).toEqual(b.recorder.contents.get(shownB?.[key]));
    }
  });

  it('a new width alone makes no texture call', async () => {
    const { tracer, calls } = make({});
    await tracer.setScene(doc());
    const at = calls.length;
    tracer.setEdges({ width: 0.2 });
    expect(calls.slice(at).filter((c) => /^(tex|createTexture|deleteTexture)/.test(c.name))).toHaveLength(0);
  });

  it('on a lost context makes no GL call; the restore uploads the new angle', async () => {
    const a = make({ edges: { sharpAngleDeg: 30 } });
    await a.tracer.setScene(doc());
    a.internals.handleContextLost({ preventDefault: () => undefined } as Event);
    const at = a.calls.length;
    a.tracer.setEdges({ sharpAngleDeg: 60 });
    expect(a.calls.length).toBe(at);
    a.internals.handleContextRestored();
    const restored = a.recorder.contents.get(a.internals.gpu?.scene?.triAttributes);
    a.tracer.dispose();
    vi.restoreAllMocks();
    const b = make({ edges: { sharpAngleDeg: 60 } });
    await b.tracer.setScene(doc());
    expect(restored).toBeDefined();
    expect(restored).toEqual(b.recorder.contents.get(b.internals.gpu?.scene?.triAttributes));
  });

  it('after a context restore it writes the new scene handle', async () => {
    const { tracer, calls, internals } = make({ edges: { sharpAngleDeg: 30 } });
    await tracer.setScene(doc());
    internals.handleContextLost({ preventDefault: () => undefined } as Event);
    internals.handleContextRestored();
    const at = calls.length;
    tracer.setEdges({ sharpAngleDeg: 60 });
    const bind = calls.slice(at).find((c) => c.name === 'bindTexture');
    expect(bind?.args[1]).toBe(internals.gpu?.scene?.triAttributes);
    expect(count(calls, 'texSubImage2D', at)).toBe(1);
  });
});

describe('dataTextureRecorder', () => {
  it('keeps what a texSubImage2D wrote although the array is mutated afterwards', () => {
    const recorder = dataTextureRecorder(4);
    const { gl } = stubGl({ onCall: recorder.onCall });
    const handle = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 2);
    const data = new Float32Array([1, 2, 3, 4]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 1, 1, 1, gl.RGBA, gl.FLOAT, data);
    data.fill(9);
    expect([...(recorder.contents.get(handle) ?? [])]).toEqual([0, 0, 0, 0, 1, 2, 3, 4]);
  });
});
