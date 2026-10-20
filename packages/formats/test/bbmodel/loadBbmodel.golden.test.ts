import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { FIXTURE_NAMES, fixture, fixtureTextureFiles, type FixtureName } from './fixtures';
import { serializeResult, worldVertices } from './serializeScene';

function load(name: FixtureName) {
  const textureFiles = fixtureTextureFiles(name);
  return loadBbmodel(fixture(name), textureFiles ? { textureFiles } : {});
}

function hasVertex(vertices: number[][], position: readonly number[]): boolean {
  return vertices.some((v) => position.every((x, k) => Math.abs((v[k] ?? NaN) - x) < 1e-5));
}

describe('loadBbmodel fixtures (data goldens)', () => {
  it.each(FIXTURE_NAMES)('%s matches its golden', async (name) => {
    await expect(serializeResult(load(name))).toMatchFileSnapshot(`__goldens__/${name}.json`);
  });

  it('loads identically from bytes and from a string', () => {
    const text = fixture('nested-groups');
    const fromBytes = loadBbmodel(new TextEncoder().encode(text));
    expect(serializeResult(fromBytes)).toBe(serializeResult(loadBbmodel(text)));
  });
});

// Hand-computed values next to the goldens, so a golden can never approve a wrong transform by itself.
describe('hand-checked transforms', () => {
  it('single-cube: an axis-aligned cube keeps its corners', () => {
    const { scene } = load('single-cube');
    expect(scene.meshes).toHaveLength(1);
    expect(scene.meshes[0]?.node).toBe(-1);
    const vertices = worldVertices(scene, 0);
    expect(vertices).toHaveLength(24);
    expect(hasVertex(vertices, [-4, 0, -4])).toBe(true);
    expect(hasVertex(vertices, [4, 8, 4])).toBe(true);
  });

  it('pivot-rotation: 22.5° about X around an off-centre pivot, inflated by 0.5', () => {
    const { scene } = load('pivot-rotation');
    const c = Math.cos(Math.PI / 8);
    const s = Math.sin(Math.PI / 8);
    // Corner (4.5, 4.5, 4.5) relative to the pivot (2, 0, 2) is (2.5, 4.5, 2.5).
    const top = [4.5, 4.5 * c - 2.5 * s, 2 + 4.5 * s + 2.5 * c];
    // Corner (−0.5, −0.5, −0.5): relative (−2.5, −0.5, −2.5).
    const bottom = [-0.5, -0.5 * c + 2.5 * s, 2 - 0.5 * s - 2.5 * c];
    const vertices = worldVertices(scene, 0);
    expect(hasVertex(vertices, top)).toBe(true);
    expect(hasVertex(vertices, bottom)).toBe(true);
  });

  it('pivot-rotation: cube 90° about Y (inflate −0.25) inside a group turned 90° about Z', () => {
    const { scene } = load('pivot-rotation');
    expect(scene.nodes[0]?.name).toBe('arm');
    expect(scene.meshes[1]?.node).toBe(0);
    // (11.75, 1.75, 1.75) − origin (4, 0, 0) → Y 90 → (1.75, 1.75, −7.75) + origin = (5.75, 1.75, −7.75);
    // − group pivot (0, 8, 0) = (5.75, −6.25, −7.75) → Z 90 → (6.25, 5.75, −7.75) + pivot = (6.25, 13.75, −7.75).
    const vertices = worldVertices(scene, 1);
    expect(hasVertex(vertices, [6.25, 13.75, -7.75])).toBe(true);
    // (8.25, 0.25, 0.25) → (4.25, 0.25, 0.25) → Y 90 → (0.25, 0.25, −4.25) + (4,0,0) = (4.25, 0.25, −4.25);
    // − (0, 8, 0) = (4.25, −7.75, −4.25) → Z 90 → (7.75, 4.25, −4.25) + (0, 8, 0) = (7.75, 12.25, −4.25).
    expect(hasVertex(vertices, [7.75, 12.25, -4.25])).toBe(true);
  });

  it('nested-groups: three levels compose, hidden group and unreferenced element survive', () => {
    const { scene, warnings } = load('nested-groups');
    expect(scene.nodes.map((n) => [n.name, n.parent, n.visible])).toEqual([
      ['body', -1, true],
      ['torso', 0, true],
      ['head', 1, true],
      ['cape', -1, false],
    ]);
    expect(scene.rootNodes).toEqual([0, 3]);
    expect(scene.meshes.map((m) => [m.name, m.node, m.visible])).toEqual([
      ['hips', 0, true],
      ['chest', 1, true],
      ['skull', 2, true],
      ['cloak', 3, false],
      ['loose', -1, true],
    ]);
    // skull (4, 20, 4): head X 90 around (0, 12, 0) → (4, 8, 8); torso identity; body Y 90 → (8, 8, −4).
    expect(hasVertex(worldVertices(scene, 2), [8, 8, -4])).toBe(true);
    // hips (4, 4, 2): body Y 90 → (2, 4, −4).
    expect(hasVertex(worldVertices(scene, 0), [2, 4, -4])).toBe(true);
    // loose sits at the root, untouched.
    expect(hasVertex(worldVertices(scene, 4), [11, 1, 11])).toBe(true);
    expect(warnings.map((w) => w.code)).toEqual(['UNKNOWN_REFERENCE']);
  });

  it('format5-groups: group data comes from the top-level groups array', () => {
    const { scene, warnings } = load('format5-groups');
    expect(scene.nodes.map((n) => [n.name, n.parent, n.pivot, n.rotation])).toEqual([
      ['stand', -1, [0, 0, 0], [0, 0, 0]],
      ['spire', 0, [0, 8, 0], [0, 0, 30]],
    ]);
    expect(scene.meshes.map((m) => m.name)).toEqual(['base', 'tip']);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNSUPPORTED_ELEMENT', '$.elements[2]'],
      ['UNSUPPORTED_ELEMENT', '$.elements[3]'],
    ]);
  });

  it('referenced-texture: the picked file is used, the URL is not fetched', () => {
    const { scene, warnings } = load('referenced-texture');
    expect(scene.textures.map((t) => [t.name, t.missing, t.width, t.height])).toEqual([
      ['Referenced.png', false, 16, 16],
      ['remote.png', true, 0, 0],
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['SOURCE_NOT_FETCHED', 'MISSING_TEXTURE']);
  });

  it('flat-cube: a zero-thickness cube keeps up and down; null removes a face, no texture key leaves it blank', () => {
    const { scene } = load('flat-cube');
    expect(scene.meshes[0]?.indices).toHaveLength(2 * 6);
    expect(scene.meshes[1]?.indices).toHaveLength(4 * 6);
    expect(scene.meshes[1]?.groups).toEqual([
      { material: -1, start: 0, count: 6 },
      { material: 0, start: 6, count: 18 },
    ]);
  });
});
