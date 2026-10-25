import { MAX_EDGE_WIDTH } from '@modelshot/looks';
import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeometryBuilder } from '../src/geometry/GeometryBuilder';
import { prepareGeometry, type GeometryParams, type PreparedGeometry } from '../src/geometry/prepareGeometry';
import { PathTracerError } from '../src/PathTracerError';
import { FakeGeometryWorker, until } from './fakeGeometryWorker';
import { mixedScene, randomTriangles, sameBytes, sceneOf, triangleMesh } from './testScenes';

const PARAMS: GeometryParams = {
  maxTriangles: 200_000,
  edges: { sharpAngleDeg: 30, reach: MAX_EDGE_WIDTH },
  maxTextureSize: 4096,
  sceneBounds: true,
};

/** 15 000 triangles: 2.3 MB of mesh arrays, so the stream sends several chunks over several tasks. */
const bigMesh = (seed: number): SceneMesh => triangleMesh(randomTriangles(15_000, seed));
const smallMesh = (seed: number): SceneMesh => triangleMesh(randomTriangles(40, seed));

/** `doc` with a texture whose bytes must never reach the worker. */
const textured = (doc: SceneDocument): SceneDocument => ({
  ...doc,
  textures: [
    {
      name: 't',
      mimeType: 'image/png',
      bytes: new Uint8Array(64),
      width: 1,
      height: 1,
      uvWidth: 1,
      uvHeight: 1,
      missing: false,
    },
  ],
});

/** The worker's code and the stream it reads meshes from. */
const workerSources = {
  ...import.meta.glob('../src/geometry/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/bake/meshStream.ts', { query: '?raw', import: 'default', eager: true }),
};

function expectSameBytes(actual: PreparedGeometry | null, expected: PreparedGeometry): void {
  if (!actual) throw new Error('no geometry');
  for (const key of ['nodes', 'triPositions', 'triAttributes'] as const) {
    expect(actual.geometry[key].rows, key).toBe(expected.geometry[key].rows);
    expect(sameBytes(actual.geometry[key].data, expected.geometry[key].data), key).toBe(true);
  }
  expect(sameBytes(actual.order, expected.order)).toBe(true);
  expect(sameBytes(actual.sources, expected.sources)).toBe(true);
  const scalars = (p: PreparedGeometry) => ({
    count: p.count,
    skipped: p.skipped,
    bounds: p.bounds,
    nodeCount: p.geometry.nodeCount,
    triangleCount: p.geometry.triangleCount,
    maxRenderOrder: p.geometry.maxRenderOrder,
  });
  expect(scalars(actual)).toEqual(scalars(expected));
}

function workerBuilder(): { builder: GeometryBuilder; worker: FakeGeometryWorker } {
  vi.stubGlobal('Worker', FakeGeometryWorker);
  const builder = GeometryBuilder.create(true);
  const worker = FakeGeometryWorker.last;
  if (!worker || !builder.inWorker) throw new Error('no fake worker');
  return { builder, worker };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeometryBuilder', () => {
  it('builds in the worker the bytes the main thread builds, scene textures never posted', async () => {
    const { builder, worker } = workerBuilder();
    const doc = textured(sceneOf([bigMesh(1), ...mixedScene().meshes], [...mixedScene().nodes]));
    const expected = prepareGeometry(doc, PARAMS);
    expectSameBytes(await builder.build(doc, PARAMS), expected);
    expect(new Set(worker.posted.map((p) => p.message.type))).toEqual(
      new Set(['meshBegin', 'meshHeaders', 'meshData', 'prepare']),
    );
    const [prepare] = worker.ofType('prepare');
    expect(prepare?.doc.textures).toEqual([]);
    expect(prepare?.doc.materials).toEqual([]);
    expect(prepare?.doc.meshes).toEqual([]);
    // Mesh bytes go as transferred chunks, several of them for this mesh.
    const chunks = worker.posted.filter((p) => p.message.type === 'meshData');
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.transfer).toHaveLength(1);
    // The packed buffers come back transferred.
    const reply = worker.replies.find((r) => r.reply.type === 'prepared');
    expect(reply?.transfer).toHaveLength(5);
  });

  it('streams a mesh once: a later build of the same mesh objects posts only the request', async () => {
    const { builder, worker } = workerBuilder();
    const mesh = smallMesh(2);
    const first = sceneOf([mesh]);
    await builder.build(first, PARAMS);
    const streamed = worker.posted.length;
    const again = { ...first, nodes: [] };
    expectSameBytes(await builder.build(again, PARAMS), prepareGeometry(again, PARAMS));
    expect(worker.posted.slice(streamed).map((p) => p.message.type)).toEqual(['prepare']);
    // A new mesh object streams, the known one does not.
    const fresh = triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const both = sceneOf([mesh, fresh]);
    const before = worker.posted.length;
    expectSameBytes(await builder.build(both, PARAMS), prepareGeometry(both, PARAMS));
    const headers = worker.ofType('meshHeaders').slice(-1)[0];
    expect(worker.posted.length - before).toBeLessThan(6);
    expect(headers?.headers.map((h) => h.lengths[0])).toEqual([9]);
  });

  it('posts everything again when the worker asks (resend), then builds', async () => {
    const { builder, worker } = workerBuilder();
    const doc = sceneOf([smallMesh(3)]);
    await builder.build(doc, PARAMS);
    worker.holdReplies = true;
    const pending = builder.build(doc, PARAMS);
    await until(() => worker.held.length === 1);
    const [prepare] = worker.held;
    if (prepare?.type !== 'prepared') throw new Error('no reply held');
    worker.held = [];
    worker.holdReplies = false;
    worker.deliver({ type: 'resend', id: prepare.id });
    expectSameBytes(await pending, prepareGeometry(doc, PARAMS));
    expect(worker.ofType('meshBegin')).toHaveLength(2);
  });

  it('settles builds in call order whatever order the replies come in', async () => {
    const { builder, worker } = workerBuilder();
    worker.holdReplies = true;
    const order: string[] = [];
    const a = builder.build(sceneOf([smallMesh(4)]), PARAMS).then(() => order.push('a'));
    const b = builder.build(sceneOf([triangleMesh([0, 0, 0, 1, 0, 0, 0, 1, 0])]), PARAMS).then(() => order.push('b'));
    await until(() => worker.held.length === 2);
    worker.release(worker.held.slice(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    worker.release();
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('rejects with the PathTracerError the worker reports', async () => {
    const { builder } = workerBuilder();
    const doc = sceneOf([triangleMesh(randomTriangles(1000, 5))]);
    const error = await builder.build(doc, { ...PARAMS, maxTextureSize: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PathTracerError);
    expect((error as PathTracerError).code).toBe('SCENE_TOO_LARGE');
    expect((error as PathTracerError).message).toMatch(
      /^triangle positions need 2 rows of 2048 texels; this GPU allows 1$/,
    );
  });

  it('a worker failing mid-build builds the pending ones inline, in call order, and every later one', async () => {
    const { builder, worker } = workerBuilder();
    worker.holdReplies = true;
    const first = sceneOf([smallMesh(6)]);
    const second = sceneOf([smallMesh(7)]);
    const order: string[] = [];
    const a = builder.build(first, PARAMS).then((p) => (order.push('a'), p));
    const b = builder.build(second, PARAMS).then((p) => (order.push('b'), p));
    await until(() => worker.posted.length > 0);
    worker.fail();
    expect(worker.terminated).toBe(true);
    expect(builder.inWorker).toBe(false);
    expectSameBytes(await a, prepareGeometry(first, PARAMS));
    expectSameBytes(await b, prepareGeometry(second, PARAMS));
    expect(order).toEqual(['a', 'b']);
    // A late reply of the dead worker changes nothing.
    worker.release();
    const posted = worker.posted.length;
    expectSameBytes(await builder.build(first, PARAMS), prepareGeometry(first, PARAMS));
    expect(worker.posted).toHaveLength(posted);
  });

  it('builds inline without Worker support, when the constructor throws, or when asked to', async () => {
    const doc = sceneOf([...mixedScene().meshes], [...mixedScene().nodes]);
    const expected = prepareGeometry(doc, PARAMS);
    vi.stubGlobal('Worker', undefined);
    const missing = GeometryBuilder.create(true);
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked by policy');
        }
      },
    );
    const throwing = GeometryBuilder.create(true);
    vi.stubGlobal('Worker', FakeGeometryWorker);
    FakeGeometryWorker.last = null;
    const off = GeometryBuilder.create(false);
    expect(FakeGeometryWorker.last).toBeNull();
    for (const builder of [missing, throwing, off]) {
      expect(builder.inWorker).toBe(false);
      expectSameBytes(await builder.build(doc, PARAMS), expected);
    }
  });

  it('dispose resolves pending builds with null, terminates the worker and ignores a late reply', async () => {
    const { builder, worker } = workerBuilder();
    worker.holdReplies = true;
    const pending = builder.build(sceneOf([smallMesh(8)]), PARAMS);
    await until(() => worker.held.length === 1);
    builder.dispose();
    expect(await pending).toBeNull();
    expect(worker.terminated).toBe(true);
    worker.release();
    expect(await builder.build(sceneOf([smallMesh(8)]), PARAMS)).toBeNull();
  });

  it('reads the worker sources', () => {
    expect(Object.keys(workerSources).length).toBeGreaterThanOrEqual(6);
  });

  it.each(Object.entries(workerSources))('%s fetches nothing and loads no remote code (local-first)', (_, source) => {
    expect(source).not.toMatch(/\bfetch\s*\(|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    expect(source).not.toMatch(/https?:\/\//);
  });
});
