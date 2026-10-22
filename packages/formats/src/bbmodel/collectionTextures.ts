import type { BbmodelWarningList } from './BbmodelWarning';
import type { ElementPlacement, HierarchyNode } from './buildHierarchy';
import { childPath, field, isJsonObject, type JsonObject } from '../json/JsonObject';
import { quoteValue } from '../text/quoteValue';

/**
 * A file's `collections` as the Hytale plugin reads them for cube face textures (hytale_plugin.js:1283-1302): a cube
 * shows the `texture` of the first collection in file order that contains it (`Collection.contains`: its uuid or an
 * ancestor group uuid in `children`, or an equal non-zero `scope`).
 */
export interface CollectionTextures {
  /** A non-empty `collections` array, which turns Hytale's `single_texture` off. */
  readonly present: boolean;
  /** Lowest index of a collection whose `children` lists the uuid (an element or a group). */
  readonly byChild: ReadonlyMap<string, number>;
  /** Lowest index of a collection with this non-zero `scope`. */
  readonly byScope: ReadonlyMap<number, number>;
  /** Texture index of each collection, −1 for none. */
  readonly texture: readonly number[];
}

const NONE: CollectionTextures = { present: false, byChild: new Map(), byScope: new Map(), texture: [] };

/**
 * Reads `collections` in one pass, O(entries + children); the array is bounded by the file size. Blockbench makes one
 * collection per entry of an array and ignores any other value; an entry that is no object warns and counts as an
 * empty collection (Blockbench cannot open a file with a `null` entry and makes any other one an empty collection).
 */
export function readCollections(
  root: JsonObject,
  textureIds: ReadonlyMap<string, number>,
  limits: { readonly maxStringChars: number },
  warnings: BbmodelWarningList,
): CollectionTextures {
  const collections = field(root, 'collections');
  if (!Array.isArray(collections) || collections.length === 0) return NONE;
  const byChild = new Map<string, number>();
  const byScope = new Map<number, number>();
  const texture: number[] = [];
  collections.forEach((entry: unknown, index) => {
    const path = childPath('$.collections', index);
    texture.push(-1);
    if (!isJsonObject(entry)) {
      const detail =
        entry === null
          ? 'Blockbench cannot open a file with a null collection; counted as an empty collection'
          : `expected an object, got ${quoteValue(entry)}; counted as an empty collection`;
      warnings.add('UNSUPPORTED_VALUE', path, detail);
      return;
    }
    readChildren(field(entry, 'children'), childPath(path, 'children'), index, byChild, limits, warnings);
    const scope = field(entry, 'scope');
    if (typeof scope === 'number' && Number.isFinite(scope)) {
      if (scope !== 0 && !byScope.has(scope)) byScope.set(scope, index);
    } else if (scope !== undefined) {
      warnings.add('UNSUPPORTED_VALUE', childPath(path, 'scope'), `expected a number, got ${quoteValue(scope)}`);
    }
    texture[index] = collectionTexture(field(entry, 'texture'), childPath(path, 'texture'), textureIds, warnings);
  });
  return { present: true, byChild, byScope, texture };
}

function readChildren(
  children: unknown,
  path: string,
  index: number,
  byChild: Map<string, number>,
  limits: { readonly maxStringChars: number },
  warnings: BbmodelWarningList,
): void {
  if (children === undefined) return;
  if (!Array.isArray(children)) {
    warnings.add('UNSUPPORTED_VALUE', path, `expected an array of uuids, got ${quoteValue(children)}`);
    return;
  }
  // Anything but a uuid-sized string can never equal an element or group uuid, so it is skipped silently.
  for (const child of children as readonly unknown[]) {
    if (typeof child !== 'string' || child === '' || child.length > limits.maxStringChars) continue;
    if (!byChild.has(child)) byChild.set(child, index);
  }
}

function collectionTexture(
  value: unknown,
  path: string,
  textureIds: ReadonlyMap<string, number>,
  warnings: BbmodelWarningList,
): number {
  if (value === undefined || value === '') return -1;
  if (typeof value !== 'string') {
    warnings.add(
      'UNSUPPORTED_VALUE',
      path,
      `expected a texture uuid, got ${quoteValue(value)}; its cubes are untextured`,
    );
    return -1;
  }
  const index = textureIds.get(value);
  if (index !== undefined) return index;
  warnings.add('UNKNOWN_REFERENCE', path, `no texture with uuid ${quoteValue(value)}; its cubes are untextured`);
  return -1;
}

/**
 * The texture each placed element shows on every non-null face when collections are present, by element index: the
 * texture of the first collection containing it, else `fallback` (the default texture). Empty without collections.
 * Linear: each group inherits the lowest collection index of its ancestors (nodes are pre-order).
 */
export function collectionElementTextures(
  collections: CollectionTextures,
  nodes: readonly HierarchyNode[],
  placements: readonly ElementPlacement[],
  elements: readonly JsonObject[],
  fallback: number,
): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  if (!collections.present) return result;
  const nodeFirst: number[] = [];
  nodes.forEach((node, index) => {
    const inherited = node.parent >= 0 ? (nodeFirst[node.parent] ?? Infinity) : Infinity;
    nodeFirst[index] = Math.min(inherited, lookup(collections.byChild, node.sourceId));
  });
  for (const { element: index, node } of placements) {
    const element = elements[index];
    if (!element) continue;
    const uuid = field(element, 'uuid');
    const scope = field(element, 'scope');
    const first = Math.min(
      node >= 0 ? (nodeFirst[node] ?? Infinity) : Infinity,
      typeof uuid === 'string' ? lookup(collections.byChild, uuid) : Infinity,
      typeof scope === 'number' && Number.isFinite(scope) && scope !== 0
        ? lookup(collections.byScope, scope)
        : Infinity,
    );
    result[index] = Number.isFinite(first) ? (collections.texture[first] ?? -1) : fallback;
  }
  return result;
}

function lookup<K>(map: ReadonlyMap<K, number>, key: K): number {
  return map.get(key) ?? Infinity;
}
