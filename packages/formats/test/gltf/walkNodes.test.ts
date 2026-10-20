import { mat4TransformPoint } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GLTF_LIMITS, type GltfLimits } from '../../src/gltf/GltfLoadOptions';
import { GltfWarningList } from '../../src/gltf/GltfWarning';
import { walkNodes } from '../../src/gltf/walkNodes';
import { GltfError } from '../../src/index';
import type { Json } from './gltfBuilder';

function walk(nodes: Json[], extra: Json = {}, limits: GltfLimits = DEFAULT_GLTF_LIMITS) {
  const warnings = new GltfWarningList();
  return { ...walkNodes({ nodes, ...extra }, 4, limits, warnings), warnings: warnings.items };
}

function failure(nodes: Json[], extra: Json = {}, limits?: GltfLimits): GltfError {
  try {
    walk(nodes, extra, limits);
  } catch (error) {
    if (error instanceof GltfError) return error;
    throw error;
  }
  throw new Error('expected a GltfError');
}

const point = (world: Float64Array, p: [number, number, number]) =>
  mat4TransformPoint(world, p).map((x) => Math.round(x * 1e9) / 1e9 || 0);
const half = Math.SQRT1_2;

describe('walkNodes', () => {
  it('composes T · R · S: scale first, then rotate, then translate', () => {
    // S (2, 1, 1), R 90° about Z, T (10, 0, 0): (1, 0, 0) -> (2, 0, 0) -> (0, 2, 0) -> (10, 2, 0).
    const { walked } = walk([{ translation: [10, 0, 0], rotation: [0, 0, half, half], scale: [2, 1, 1], mesh: 0 }]);
    expect(point(walked[0]!.world, [1, 0, 0])).toEqual([10, 2, 0]);
  });

  it('takes a column-major matrix, and the parent world matrix first', () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1];
    const { walked, nodes } = walk([{ matrix: translate, children: [1] }, { translation: [1, 0, 0] }]);
    expect(point(walked[1]!.world, [0, 0, 0])).toEqual([1, 5, 0]);
    expect(nodes.map((n) => [n.parent, n.children])).toEqual([
      [-1, [1]],
      [0, []],
    ]);
  });

  it('normalises a quaternion; a zero one is invalid', () => {
    const { walked } = walk([{ rotation: [0, 0, 2, 2] }]);
    expect(point(walked[0]!.world, [1, 0, 0])).toEqual([0, 1, 0]);
    expect(failure([{ rotation: [0, 0, 0, 0] }])).toMatchObject({ code: 'INVALID_FIELD', path: '$.nodes[0].rotation' });
  });

  it('a matrix beside TRS wins, with a warning', () => {
    const { walked, warnings } = walk(
      [{ matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1], translation: [9, 9, 9] }],
      { scenes: [{ nodes: [0] }] },
    );
    expect(point(walked[0]!.world, [1, 1, 1])).toEqual([2, 2, 2]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['INVALID_TRANSFORM', '$.nodes[0]']]);
  });

  it('emits identity scene nodes parents first, in depth-first source order', () => {
    const { nodes, rootNodes } = walk(
      [{ name: 'a', children: [2, 1] }, { name: 'b' }, { name: 'c', children: [3] }, { name: 'd' }],
      { scenes: [{ nodes: [0] }] },
    );
    expect(nodes.map((n) => [n.name, n.parent])).toEqual([
      ['a', -1],
      ['c', 0],
      ['d', 1],
      ['b', 0],
    ]);
    expect(rootNodes).toEqual([0]);
    expect(nodes.every((n) => n.translation.every((x) => x === 0) && n.rotation.every((x) => x === 0))).toBe(true);
  });

  it('rejects a cycle, two parents, a self child and a root that is a child', () => {
    expect(failure([{ children: [1] }, { children: [0] }]).code).toBe('NODE_GRAPH_INVALID');
    expect(failure([{ children: [1] }, { children: [2] }, { children: [1] }]).code).toBe('NODE_GRAPH_INVALID');
    expect(failure([{ children: [2] }, { children: [2] }, {}])).toMatchObject({
      code: 'NODE_GRAPH_INVALID',
      path: '$.nodes[1]',
    });
    expect(failure([{ children: [0] }])).toMatchObject({ code: 'NODE_GRAPH_INVALID', path: '$.nodes[0]' });
    expect(failure([{ children: [1] }, {}], { scenes: [{ nodes: [1] }] })).toMatchObject({
      code: 'NODE_GRAPH_INVALID',
      path: '$.scenes[0].nodes[0]',
    });
    expect(failure([{}], { scenes: [{ nodes: [0, 0] }] }).code).toBe('NODE_GRAPH_INVALID');
    expect(failure([{ children: [5] }])).toMatchObject({ code: 'INVALID_FIELD', path: '$.nodes[0].children[0]' });
  });

  it('accepts maxNesting levels and rejects one more, without recursion', () => {
    const chain = (depth: number) =>
      Array.from({ length: depth }, (_, i) => (i + 1 < depth ? { children: [i + 1] } : {}));
    const limits = { ...DEFAULT_GLTF_LIMITS, maxNesting: 8 };
    expect(walk(chain(8), {}, limits).nodes).toHaveLength(8);
    expect(failure(chain(9), {}, limits)).toMatchObject({ code: 'NESTING_TOO_DEEP', path: '$.nodes[8]' });
    const deep = { ...DEFAULT_GLTF_LIMITS, maxNesting: Infinity, maxNodes: Infinity };
    expect(walk(chain(50_000), {}, deep).nodes).toHaveLength(50_000);
  });

  it('without scenes draws every root node and says so; extra scenes are reported', () => {
    const none = walk([{ name: 'a' }, { name: 'b' }]);
    expect(none.rootNodes).toEqual([0, 1]);
    expect(none.warnings.map((w) => w.code)).toEqual(['NO_SCENE']);
    const two = walk([{ name: 'a' }, { name: 'b' }], { scenes: [{ nodes: [0] }, { nodes: [1] }], scene: 1 });
    expect(two.nodes.map((n) => n.name)).toEqual(['b']);
    expect(two.warnings.map((w) => [w.code, w.path])).toEqual([['EXTRA_SCENES_IGNORED', '$.scenes']]);
  });

  it('rejects a mesh index out of range and a world transform that overflows', () => {
    expect(failure([{ mesh: 4 }])).toMatchObject({ code: 'INVALID_FIELD', path: '$.nodes[0].mesh' });
    const big = { scale: [1e200, 1e200, 1e200] };
    expect(failure([{ ...big, children: [1] }, big])).toMatchObject({ code: 'NON_FINITE_DATA', path: '$.nodes[1]' });
  });
});
