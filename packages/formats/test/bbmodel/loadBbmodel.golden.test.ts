import { animateScene, animationFrameTimes, worldMatrices, type SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { loadBbmodel } from '../../src/index';
import { FIXTURE_NAMES, fixture, fixtureTextureFiles, type FixtureName } from './fixtures';
import { printJson, round, serializeResult, worldVertices } from '../support/serializeScene';

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

  it('animated.frames matches its golden', async () => {
    await expect(serializeFrames(load('animated').scene)).toMatchFileSnapshot('__goldens__/animated.frames.json');
  });

  it('loads identically from bytes and from a string', () => {
    const text = fixture('nested-groups');
    const fromBytes = loadBbmodel(new TextEncoder().encode(text));
    expect(serializeResult(fromBytes)).toBe(serializeResult(loadBbmodel(text)));
  });
});

/**
 * Golden frames: every animation of `scene` at the start, inside the first keyframe gap, at a keyframe, just before
 * and at the end, past the end (where once, hold and loop differ) and in the third repetition; node transforms rounded
 * to 1e-6, plus the export frame times at 24 fps.
 */
function serializeFrames(scene: SceneDocument): string {
  const vec = (v: ArrayLike<number> | undefined) => (v ? Array.from(v, (x) => round(x, 1e-6)) : undefined);
  const animations = (scene.animations ?? []).map((animation, index) => {
    const times = [0, 0.125, 0.5, animation.length - 0.05, animation.length, animation.length + 0.3];
    times.push(2 * animation.length + 0.1);
    return {
      name: animation.name,
      loop: animation.loop,
      length: animation.length,
      frames: times.map((time) => {
        const { document, clipTime } = animateScene(scene, { animation: index, time });
        const world = worldMatrices(document.nodes);
        return {
          time: round(time, 1e-6),
          clipTime: clipTime === null ? null : round(clipTime, 1e-6),
          nodes: document.nodes.map((node, i) => ({
            name: node.name,
            rotation: vec(node.rotation),
            translation: vec(node.translation),
            scale: vec(node.scale) ?? null,
            world: vec(world[i]),
          })),
        };
      }),
      frameTimes24: animationFrameTimes(animation, 24).map((t) => round(t, 1e-6)),
    };
  });
  return printJson({ animations });
}

/** three.js CatmullRom between p1 and p2, written out as the Hermite form. */
function catmullRom(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const m1 = (p2 - p0) / 2;
  const m2 = (p3 - p1) / 2;
  return (
    (2 * t ** 3 - 3 * t ** 2 + 1) * p1 +
    (t ** 3 - 2 * t ** 2 + t) * m1 +
    (-2 * t ** 3 + 3 * t ** 2) * p2 +
    (t ** 3 - t ** 2) * m2
  );
}

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
    expect(scene.meshes.map((m) => m.name)).toEqual(['base', 'tip', 'sculpt']);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNSUPPORTED_ELEMENT', '$.elements[2]']]);
  });

  it('referenced-texture: the picked file is used, the URL is not fetched', () => {
    const { scene, warnings } = load('referenced-texture');
    expect(scene.textures.map((t) => [t.name, t.missing, t.width, t.height])).toEqual([
      ['Referenced.png', false, 16, 16],
      ['remote.png', true, 0, 0],
    ]);
    expect(warnings.map((w) => w.code)).toEqual(['SOURCE_NOT_FETCHED', 'MISSING_TEXTURE']);
  });

  it('flat-cube: a zero-thickness cube keeps up and down, single-sided; null removes a face, no texture key leaves it blank', () => {
    const { scene } = load('flat-cube');
    expect(scene.meshes[0]?.indices).toHaveLength(2 * 6);
    expect(scene.meshes[0]?.groups).toEqual([{ material: 0, start: 0, count: 12, doubleSided: false }]);
    expect(scene.meshes[1]?.indices).toHaveLength(4 * 6);
    expect(scene.meshes[1]?.groups).toEqual([
      { material: -1, start: 0, count: 6, doubleSided: true },
      { material: 0, start: 6, count: 18, doubleSided: true },
    ]);
  });

  it('alpha-plane: the cutout plane turns −50° about X around its origin (−8, 9, 0)', () => {
    const { scene } = load('alpha-plane');
    expect(scene.meshes[1]?.name).toBe('cutout-plane');
    // Corner (−8, −8, 0) from the origin: y' = −8 cos 50°, z' = 8 sin 50°.
    const corner = [-16, 9 - 8 * Math.cos((50 * Math.PI) / 180), 8 * Math.sin((50 * Math.PI) / 180)];
    expect(hasVertex(worldVertices(scene, 1), corner)).toBe(true);
    expect(scene.meshes.map((m) => m.groups.map((g) => g.doubleSided))).toEqual([[true], [true], [true], [false]]);
  });

  describe('animated frames', () => {
    const scene = load('animated').scene;
    const at = (animation: string, time: number) => animateScene(scene, { animation, time }).document.nodes;

    // The fixture is format 4.10: rotation x, y and position x are negated on load, as Blockbench 5 imports it.
    it('loads four animations without warnings, keyframes sorted, numeric strings read, 4.x axes converted', () => {
      const { warnings } = load('animated');
      expect(warnings).toEqual([]);
      expect(scene.animations?.map((a) => [a.name, a.loop, a.length, a.channels.length])).toEqual([
        ['bob', 'loop', 1, 2],
        ['spin', 'hold', 2, 1],
        ['squash', 'once', 1, 1],
        ['mixed', 'loop', 2, 2],
      ]);
      const mixed = scene.animations?.[3]?.channels[0];
      expect(mixed?.node).toBe(1);
      expect(mixed?.keyframes.map((k) => [k.time, k.value, k.interpolation])).toEqual([
        [0, [-10, 0, -2.5], 'linear'],
        [1, [0, 0, 45], 'catmullrom'],
        [1.5, [-5, -5, 5], 'step'],
        [2, [0, 0, 0], 'linear'],
      ]);
    });

    it('bob: linear into a pre/post split, step positions', () => {
      expect(at('bob', 0.25)[0]?.translation).toEqual([0, 1, 0]);
      expect(at('bob', 0.5)[0]?.translation).toEqual([0, 2, 0]);
      expect(at('bob', 0.75)[0]?.translation).toEqual([0, 2, 0]);
      expect(at('bob', 1.25)[0]?.translation).toEqual([0, 1, 0]);
      expect(at('bob', 0.25)[1]?.translation).toEqual([-1, 0, 0]);
      expect(at('bob', 0.5)[1]?.translation).toEqual([1, 0, 0]);
    });

    it('spin: catmull-rom past 360°, added to the rest rotation, held after the end', () => {
      const y = at('spin', 0.25)[1]?.rotation[1] ?? NaN;
      expect(y).toBeCloseTo(catmullRom(0.5, 0, 0, -90, -360), 9);
      expect(at('spin', 3)[1]?.rotation).toEqual([0, -720, 10]);
    });

    it('squash: scale about the pivot, clamped at 0, rest after a once clip ends', () => {
      expect(at('squash', 0.75)[0]?.scale).toEqual([1.5, 0.25, 1]);
      expect(at('squash', 1)[0]?.scale).toEqual([1, 1e-4, 1]);
      expect(at('squash', 1.3)[0]?.scale).toBeUndefined();
      // Trunk corner (2, 8, 2) scaled by (2, 0.5, 1) about the body pivot (0, 0, 0).
      const squashed = { ...scene, nodes: at('squash', 0.5) };
      expect(hasVertex(worldVertices(squashed, 0), [4, 4, 2])).toBe(true);
      // Normals go through the normal matrix and stay unit length under the non-uniform scale.
      for (const vertex of worldVertices(squashed, 0)) expect(Math.hypot(...vertex.slice(3, 6))).toBeCloseTo(1, 5);
    });

    it('mixed: a name-keyed animator, linear into catmull-rom wrapping its neighbours, step', () => {
      expect(at('mixed', 0)[1]?.rotation).toEqual([-10, 0, 7.5]);
      const half = at('mixed', 0.5)[1]?.rotation ?? [];
      const neighbour = [-5, -5, 5];
      const expected = [0, 1, 2].map((k) =>
        catmullRom(0.5, neighbour[k] ?? 0, [-10, 0, -2.5][k] ?? 0, [0, 0, 45][k] ?? 0, neighbour[k] ?? 0),
      );
      expected.forEach((value, k) => expect(half[k]).toBeCloseTo(value + (k === 2 ? 10 : 0), 9));
      expect(at('mixed', 1.75)[1]?.rotation).toEqual([-5, -5, 15]);
      expect(at('mixed', 1)[1]?.translation).toEqual([0, 0, 0]);
      expect(at('mixed', 0)[1]?.translation).toEqual([0, 1, 0]);
    });
  });
});
