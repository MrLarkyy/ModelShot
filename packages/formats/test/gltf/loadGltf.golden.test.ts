import { describe, expect, it } from 'vitest';
import { loadGltf } from '../../src/index';
import { serializeResult, worldVertices } from '../support/serializeScene';
import { GLTF_FIXTURE_NAMES, gltfFixture, gltfFixtureFiles, type GltfFixtureName } from './fixtures';
import { toGlb } from './gltfBuilder';

function load(name: GltfFixtureName) {
  const files = gltfFixtureFiles(name);
  return loadGltf(gltfFixture(name), files ? { files } : {});
}

function hasVertex(vertices: number[][], position: readonly number[]): boolean {
  return vertices.some((v) => position.every((x, k) => Math.abs((v[k] ?? NaN) - x) < 1e-4));
}

describe('loadGltf fixtures (data goldens)', () => {
  it.each(GLTF_FIXTURE_NAMES)('%s matches its golden', async (name) => {
    await expect(serializeResult(load(name))).toMatchFileSnapshot(`__goldens__/${name}.json`);
  });

  it('loads identically twice, and from bytes', () => {
    const text = gltfFixture('scene-nodes');
    const first = serializeResult(loadGltf(text));
    expect(serializeResult(loadGltf(text))).toBe(first);
    expect(serializeResult(loadGltf(new TextEncoder().encode(text)))).toBe(first);
  });

  it('a GLB built from scene-nodes.gltf loads to the identical document, but for its container', () => {
    const text = gltfFixture('scene-nodes');
    const glb = loadGltf(toGlb(JSON.parse(text) as Record<string, unknown>));
    expect(glb.scene.source).toEqual({ format: 'gltf', formatVersion: '2.0', modelFormat: 'glb' });
    const gltf = loadGltf(text);
    expect(gltf.scene.source.modelFormat).toBe('gltf');
    const withoutSource = (result: typeof gltf) =>
      serializeResult({ ...result, scene: { ...result.scene, source: glb.scene.source } });
    expect(withoutSource(glb)).toBe(withoutSource(gltf));
    gltf.scene.meshes.forEach((mesh, i) => {
      expect(glb.scene.meshes[i]?.positions).toEqual(mesh.positions);
      expect(glb.scene.meshes[i]?.uvs).toEqual(mesh.uvs);
    });
    gltf.scene.textures.forEach((texture, i) => expect(glb.scene.textures[i]?.bytes).toEqual(texture.bytes));
  });
});

// Hand-computed values next to the goldens, so a golden can never approve a wrong transform by itself.
describe('scene-nodes: hand-checked', () => {
  const { scene, warnings } = load('scene-nodes');
  const mesh = (name: string, nth = 0) => {
    const index = scene.meshes.map((m, i) => [m.name, i] as const).filter(([n]) => n === name)[nth]?.[1];
    if (index === undefined) throw new Error(`no mesh ${name}`);
    return index;
  };

  it('keeps the hierarchy with identity nodes, two roots and the cube instanced twice', () => {
    expect(scene.nodes.map((n) => [n.name, n.parent])).toEqual([
      ['ground', -1],
      ['model', -1],
      ['parent', 1],
      ['child', 2],
      ['matrix-leaf', 1],
      ['mirrored-roof', 1],
      ['cutout', 1],
      ['glass', 1],
      ['panel', 1],
    ]);
    expect(scene.rootNodes).toEqual([0, 1]);
    for (const node of scene.nodes) {
      expect([...node.pivot, ...node.rotation, ...node.translation].every((x) => x === 0)).toBe(true);
    }
    expect(scene.meshes.filter((m) => m.name === 'cube')).toHaveLength(2);
    expect(warnings).toEqual([]);
  });

  it('places the parent cube: T(-0.45, 0.25, -0.35) R_y(30°) S(0.5) under S(2), times 16', () => {
    // Corner (0.5, 0.5, 0.5) of the unit cube: S 0.5 -> 0.25; R_y 30 -> x = 0.25 cos + 0.25 sin, z = -0.25 sin + 0.25 cos.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const local = [-0.45 + 0.25 * c + 0.25 * s, 0.25 + 0.25, -0.35 - 0.25 * s + 0.25 * c];
    expect(
      hasVertex(
        worldVertices(scene, mesh('cube')),
        local.map((x) => x * 2 * 16),
      ),
    ).toBe(true);
  });

  it('places the child cube through both parents (non-uniform scale under a rotation)', () => {
    // Child corner (0.5, 0.5, 0.5): S(0.6, 0.3, 0.6) -> (0.3, 0.15, 0.3); R_z 45 -> (0.3c - 0.15s, 0.3s + 0.15c, 0.3);
    // + T(0, 0.85, 0); then the parent's S 0.5, R_y 30, T; then S 2 and 16.
    const r = Math.SQRT1_2;
    const child = [0.3 * r - 0.15 * r, 0.3 * r + 0.15 * r + 0.85, 0.3].map((x) => x * 0.5);
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const [x = 0, y = 0, z = 0] = child;
    const world = [-0.45 + x * c + z * s, 0.25 + y, -0.35 - x * s + z * c];
    expect(
      hasVertex(
        worldVertices(scene, mesh('cube', 1)),
        world.map((v) => v * 32),
      ),
    ).toBe(true);
  });

  it('the mirrored roof keeps outward counter-clockwise triangles', () => {
    const roof = scene.meshes[mesh('roof')];
    if (!roof) throw new Error('no roof');
    expect(roof.indices).toHaveLength(12);
    for (let t = 0; t < roof.indices.length; t += 3) {
      const p = [0, 1, 2].map((c) => [0, 1, 2].map((k) => roof.positions[(roof.indices[t + c] ?? 0) * 3 + k] ?? 0));
      const [a = [], b = [], d = []] = p;
      const e1 = [0, 1, 2].map((k) => (b[k] ?? 0) - (a[k] ?? 0));
      const e2 = [0, 1, 2].map((k) => (d[k] ?? 0) - (a[k] ?? 0));
      const cross = [
        (e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0),
        (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0),
        (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0),
      ];
      const normal = [0, 1, 2].map((k) => roof.normals[(roof.indices[t] ?? 0) * 3 + k] ?? 0);
      // A roof slope faces up and away from the ridge: positive y, and its cross product agrees with its normal.
      expect(cross[1]).toBeGreaterThan(0);
      expect(cross.reduce((sum, v, k) => sum + v * (normal[k] ?? 0), 0)).toBeGreaterThan(0);
    }
  });

  it('maps the materials: modes, cutoffs, sidedness, factor textures, texture dedupe', () => {
    expect(scene.materials.map((m) => [m.name, m.alphaMode, m.alphaCutoff, m.texture])).toEqual([
      ['atlas', 'opaque', undefined, 0],
      ['cutout', 'mask', 0.5, 1],
      ['glass', 'blend', 0.5 / 255, 2],
      ['ground', 'opaque', undefined, 3],
      ['leaf', 'mask', 0.5, 1],
      ['panel', 'opaque', undefined, 0],
      ['red', 'opaque', undefined, 4],
    ]);
    expect(scene.textures.map((t) => [t.name, t.width, t.height])).toEqual([
      ['atlas', 18, 12],
      ['cutout', 8, 8],
      ['glass', 4, 4],
      ['colour #bcbcbcff', 1, 1],
      ['colour #e7593fff', 1, 1],
    ]);
    expect(scene.meshes[mesh('leaf')]?.groups).toEqual([{ material: 4, start: 0, count: 6, doubleSided: true }]);
  });

  it('bakes the panel texture transform onto TEXCOORD_1: the -X face region of the atlas, inside its sentinel ring', () => {
    const panel = scene.meshes[mesh('panel')];
    const uv = [...(panel?.uvs ?? [])].map((x) => Math.round(x * 1e4) / 1e4);
    const [u0, v0, u1, v1] = [7 / 18, 1 / 12, 11 / 18, 5 / 12].map((x) => Math.round(x * 1e4) / 1e4);
    expect(uv).toEqual([u0, v1, u1, v1, u1, v0, u0, v0]);
    expect([...(panel?.uvRects.slice(0, 4) ?? [])].map((x) => Math.round(x * 1e4) / 1e4)).toEqual([u0, v0, u1, v1]);
  });
});

describe('external: buffers and images from picked files', () => {
  it('reads ./external.bin and textures/External.PNG from the map by path and base name', () => {
    const { scene, warnings } = load('external');
    expect(warnings).toEqual([]);
    expect(scene.textures.map((t) => [t.name, t.missing, t.width])).toEqual([['External.PNG', false, 8]]);
    expect(scene.meshes[0]?.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
  });

  it('without the picked files the buffer is a MISSING_BUFFER error naming it', () => {
    expect(() => loadGltf(gltfFixture('external'))).toThrow(
      /Missing buffer at \$\.buffers\[0\]\.uri: pick the file "external\.bin"/,
    );
  });
});
