import { mat4Identity, mat4Multiply, type Mat4, type SceneNode } from '@modelshot/scene';
import { GltfError } from './GltfError';
import type { GltfLimits } from './GltfLoadOptions';
import type { GltfWarningList } from './GltfWarning';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import {
  readIndex,
  readList,
  readNumbers,
  readObjects,
  readOptionalIndex,
  readOptionalNumbers,
  readOptionalString,
} from './gltfFields';

/** A node of the active scene, in the order its `SceneNode` was emitted (parents first). */
export interface WalkedNode {
  /** Index in the glTF `nodes`. */
  readonly source: number;
  /** Index in the emitted `SceneNode` list. */
  readonly sceneIndex: number;
  readonly path: string;
  /** glTF world matrix (column-major), parents' transforms included. */
  readonly world: Mat4;
  /** glTF mesh index, if the node has one. */
  readonly mesh: number | undefined;
}

export interface NodeWalk {
  /** Hierarchy and names only: every transform is identity, because the world matrices are baked into the meshes. */
  readonly nodes: MutableNode[];
  readonly rootNodes: number[];
  readonly walked: WalkedNode[];
}

/** A `SceneNode` whose mesh list the loader fills in after baking. */
export type MutableNode = Omit<SceneNode, 'children' | 'meshes'> & { children: number[]; meshes: number[] };

/**
 * Validates the whole node graph (every child index in range, one parent at most, no cycle, depth within
 * `maxNesting`) without recursion, then walks the active scene depth-first with an explicit stack, composing world
 * matrices. Nodes outside the active scene are not emitted.
 */
export function walkNodes(
  json: JsonObject,
  meshCount: number,
  limits: GltfLimits,
  warnings: GltfWarningList,
): NodeWalk {
  const objects = readObjects(
    readList(json, 'nodes', '$', { max: limits.maxNodes, code: 'TOO_MANY_NODES', what: 'nodes' }),
    '$.nodes',
  );
  const children = readChildren(objects, limits);
  const parentOf = new Int32Array(objects.length).fill(-1);
  children.forEach((list, parent) => {
    for (const child of list) {
      const path = childPath('$.nodes', parent);
      if (child === parent) throw new GltfError('NODE_GRAPH_INVALID', path, 'a node is its own child');
      if (parentOf[child] !== -1) {
        throw new GltfError(
          'NODE_GRAPH_INVALID',
          path,
          `node ${child} has two parents (${parentOf[child]} and ${parent})`,
        );
      }
      parentOf[child] = parent;
    }
  });
  checkForestDepth(children, parentOf, limits.maxNesting);
  const roots = sceneRoots(json, parentOf, limits, warnings);

  const nodes: MutableNode[] = [];
  const walked: WalkedNode[] = [];
  const stack: { source: number; parent: number; parentWorld: Mat4 }[] = roots
    .map((source) => ({ source, parent: -1, parentWorld: mat4Identity() }))
    .reverse();
  for (let item = stack.pop(); item; item = stack.pop()) {
    const { source, parent, parentWorld } = item;
    const object = objects[source] ?? {};
    const path = childPath('$.nodes', source);
    const world = mat4Multiply(parentWorld, localMatrix(object, path, warnings));
    if (!world.every(Number.isFinite)) throw new GltfError('NON_FINITE_DATA', path, 'the world transform overflows');
    const sceneIndex = nodes.length;
    nodes.push({
      name: readOptionalString(object, 'name', path, limits.maxStringChars, `node ${source}`),
      sourceId: '',
      parent,
      children: [],
      pivot: [0, 0, 0],
      rotation: [0, 0, 0],
      translation: [0, 0, 0],
      visible: true,
      meshes: [],
    });
    if (parent >= 0) nodes[parent]?.children.push(sceneIndex);
    walked.push({ source, sceneIndex, path, world, mesh: readOptionalIndex(object, 'mesh', path, meshCount) });
    const list = children[source] ?? [];
    for (let k = list.length - 1; k >= 0; k--)
      stack.push({ source: list[k] ?? 0, parent: sceneIndex, parentWorld: world });
  }
  const rootNodes = nodes.flatMap((node, index) => (node.parent < 0 ? [index] : []));
  return { nodes, rootNodes, walked };
}

function readChildren(objects: readonly JsonObject[], limits: GltfLimits): number[][] {
  return objects.map((object, index) => {
    const path = childPath('$.nodes', index);
    const list = readList(object, 'children', path, { max: limits.maxNodes, code: 'TOO_MANY_NODES', what: 'children' });
    return list.map((value, k) => readIndex(value, childPath(childPath(path, 'children'), k), objects.length));
  });
}

/** Every node must hang below a parentless node (else it is on a cycle), at most `maxNesting` deep. */
function checkForestDepth(children: readonly number[][], parentOf: Int32Array, maxNesting: number): void {
  const stack: [number, number][] = [];
  parentOf.forEach((parent, node) => {
    if (parent === -1) stack.push([node, 1]);
  });
  const reached = new Uint8Array(parentOf.length);
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [node, depth] = item;
    reached[node] = 1;
    if (depth > maxNesting) {
      throw new GltfError('NESTING_TOO_DEEP', childPath('$.nodes', node), `deeper than ${maxNesting} levels`);
    }
    for (const child of children[node] ?? []) stack.push([child, depth + 1]);
  }
  const unreached = reached.indexOf(0);
  if (unreached >= 0) {
    throw new GltfError('NODE_GRAPH_INVALID', childPath('$.nodes', unreached), 'the node hierarchy has a cycle');
  }
}

function sceneRoots(json: JsonObject, parentOf: Int32Array, limits: GltfLimits, warnings: GltfWarningList): number[] {
  const scenes = readObjects(
    readList(json, 'scenes', '$', { max: limits.maxNodes, code: 'TOO_MANY_NODES', what: 'scenes' }),
    '$.scenes',
  );
  const chosen = readOptionalIndex(json, 'scene', '$', scenes.length) ?? (scenes.length > 0 ? 0 : undefined);
  if (chosen === undefined) {
    if (parentOf.length > 0) warnings.add('NO_SCENE', '$', 'no scene is defined; every root node is drawn');
    const roots: number[] = [];
    parentOf.forEach((parent, node) => {
      if (parent === -1) roots.push(node);
    });
    return roots;
  }
  if (scenes.length > 1) {
    warnings.add('EXTRA_SCENES_IGNORED', '$.scenes', `${scenes.length} scenes; only scene ${chosen} is drawn`);
  }
  const path = childPath('$.scenes', chosen);
  const list = readList(scenes[chosen] ?? {}, 'nodes', path, {
    max: limits.maxNodes,
    code: 'TOO_MANY_NODES',
    what: 'root nodes',
  });
  const seen = new Set<number>();
  return list.map((value, k) => {
    const rootPath = childPath(childPath(path, 'nodes'), k);
    const root = readIndex(value, rootPath, parentOf.length);
    if (parentOf[root] !== -1) throw new GltfError('NODE_GRAPH_INVALID', rootPath, `root node ${root} has a parent`);
    if (seen.has(root)) throw new GltfError('NODE_GRAPH_INVALID', rootPath, `root node ${root} is listed twice`);
    seen.add(root);
    return root;
  });
}

/** `matrix`, else `T · R · S` (glTF order); a quaternion is normalised, a zero one is invalid. */
export function localMatrix(node: JsonObject, path: string, warnings: GltfWarningList): Mat4 {
  const hasTrs = ['translation', 'rotation', 'scale'].some((key) => field(node, key) !== undefined);
  const matrixValue = field(node, 'matrix');
  if (matrixValue !== undefined) {
    const m = readNumbers(matrixValue, childPath(path, 'matrix'), 16);
    if (hasTrs)
      warnings.add('INVALID_TRANSFORM', path, 'both matrix and translation/rotation/scale; the matrix is used');
    return Float64Array.from(m);
  }
  const [tx = 0, ty = 0, tz = 0] = readOptionalNumbers(node, 'translation', path, [0, 0, 0]);
  const [qx = 0, qy = 0, qz = 0, qw = 1] = readOptionalNumbers(node, 'rotation', path, [0, 0, 0, 1]);
  const [sx = 1, sy = 1, sz = 1] = readOptionalNumbers(node, 'scale', path, [1, 1, 1]);
  const length = Math.hypot(qx, qy, qz, qw);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new GltfError('INVALID_FIELD', childPath(path, 'rotation'), 'expected a non-zero quaternion');
  }
  const [x, y, z, w] = [qx / length, qy / length, qz / length, qw / length];
  // prettier-ignore
  return Float64Array.from([
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}
