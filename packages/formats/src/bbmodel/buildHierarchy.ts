import type { Vec3 } from '@modelshot/scene';
import { BbmodelError } from './BbmodelError';
import type { BbmodelLimits } from './BbmodelLoadOptions';
import type { BbmodelWarningList } from './BbmodelWarning';
import { childPath, field, type JsonObject } from '../json/JsonObject';
import {
  readArray,
  readObject,
  readOptionalBoolean,
  readOptionalString,
  readOptionalVec3,
  readString,
} from './JsonFields';
import { quoteValue } from '../text/quoteValue';

export interface HierarchyNode {
  readonly name: string;
  readonly sourceId: string;
  readonly parent: number;
  readonly children: number[];
  readonly pivot: Vec3;
  readonly rotation: Vec3;
  readonly visible: boolean;
}

/** An element placed under a node (−1: the model root). */
export interface ElementPlacement {
  readonly element: number;
  readonly node: number;
}

export interface Hierarchy {
  /** Pre-order: every parent precedes its children. */
  readonly nodes: readonly HierarchyNode[];
  readonly rootNodes: readonly number[];
  /** Outliner order, then elements the outliner does not reference, in file order. */
  readonly placements: readonly ElementPlacement[];
}

interface Pending {
  readonly item: unknown;
  readonly path: string;
  readonly parent: number;
  /** Groups above this item. */
  readonly depth: number;
}

export interface HierarchyOptions {
  /** Negate every group's z rotation (files before format 3.2, as Blockbench imports them). */
  readonly invertGroupZ?: boolean;
}

interface GroupData {
  readonly data: JsonObject;
  readonly path: string;
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * Walks the outliner with an explicit stack (no recursion, so nesting is bounded by the limit, not the call stack).
 * A string is an element uuid; an object is a group, its data inline (format 4.x) or in the top-level `groups` array
 * by uuid (format 5.x).
 */
export function buildHierarchy(
  root: JsonObject,
  elementIds: ReadonlyMap<string, number>,
  elementCount: number,
  limits: BbmodelLimits,
  warnings: BbmodelWarningList,
  options: HierarchyOptions = {},
): Hierarchy {
  const groupData = readGroupData(root, limits);
  const maxItems = limits.maxElements + limits.maxGroups;
  const tooMany = { max: maxItems, code: 'TOO_MANY_ELEMENTS', what: 'outliner entries' } as const;
  const nodes: HierarchyNode[] = [];
  const rootNodes: number[] = [];
  const placements: ElementPlacement[] = [];
  const placedElements = new Set<number>();
  const seenGroups = new Set<string>();
  const stack: Pending[] = [];
  let itemCount = 0;

  const pushChildren = (items: readonly unknown[], path: string, parent: number, depth: number): void => {
    itemCount += items.length;
    if (itemCount > maxItems) {
      throw new BbmodelError('TOO_MANY_ELEMENTS', path, `more than ${maxItems} outliner entries`);
    }
    for (let i = items.length - 1; i >= 0; i--) stack.push({ item: items[i], path: childPath(path, i), parent, depth });
  };

  const outliner = field(root, 'outliner');
  if (outliner !== undefined) pushChildren(readArray(outliner, '$.outliner', tooMany), '$.outliner', -1, 0);

  for (let pending = stack.pop(); pending; pending = stack.pop()) {
    const { item, path, parent, depth } = pending;
    if (typeof item === 'string') {
      const uuid = readString(item, path, limits.maxStringChars);
      const element = elementIds.get(uuid);
      if (element === undefined) {
        warnings.add('UNKNOWN_REFERENCE', path, `no element with uuid ${quoteValue(uuid)}`);
        continue;
      }
      if (placedElements.has(element)) {
        throw new BbmodelError('DUPLICATE_REFERENCE', path, `element ${quoteValue(uuid)} is already in the outliner`);
      }
      placedElements.add(element);
      placements.push({ element, node: parent });
      continue;
    }
    const entry = readObject(item, path);
    if (depth + 1 > limits.maxNesting) {
      throw new BbmodelError('NESTING_TOO_DEEP', path, `more than ${limits.maxNesting} nested groups`);
    }
    const sourceId = readOptionalString(entry, 'uuid', path, limits.maxStringChars, '');
    if (sourceId !== '') {
      if (seenGroups.has(sourceId)) {
        throw new BbmodelError('DUPLICATE_REFERENCE', path, `group ${quoteValue(sourceId)} is already in the outliner`);
      }
      seenGroups.add(sourceId);
    }
    if (nodes.length >= limits.maxGroups) {
      throw new BbmodelError('TOO_MANY_ELEMENTS', path, `more than ${limits.maxGroups} groups`);
    }
    const group = groupData.get(sourceId) ?? { data: entry, path };
    const index = nodes.length;
    nodes.push({
      name: readOptionalString(group.data, 'name', group.path, limits.maxStringChars, 'group'),
      sourceId,
      parent,
      children: [],
      pivot: readOptionalVec3(group.data, 'origin', group.path, ZERO),
      rotation: groupRotation(readOptionalVec3(group.data, 'rotation', group.path, ZERO), options),
      visible: readOptionalBoolean(group.data, 'visibility', group.path, true),
    });
    if (parent < 0) rootNodes.push(index);
    else nodes[parent]?.children.push(index);
    const children = field(entry, 'children');
    const childrenPath = childPath(path, 'children');
    if (children !== undefined)
      pushChildren(readArray(children, childrenPath, tooMany), childrenPath, index, depth + 1);
  }

  for (let element = 0; element < elementCount; element++) {
    if (!placedElements.has(element)) placements.push({ element, node: -1 });
  }
  return { nodes, rootNodes, placements };
}

function groupRotation(rotation: Vec3, options: HierarchyOptions): Vec3 {
  // `0 - z` rather than `-z`, so a zero stays +0.
  return options.invertGroupZ ? [rotation[0], rotation[1], 0 - rotation[2]] : rotation;
}

/** Format 5.x keeps group data in a top-level `groups` array and only uuids and children in the outliner. */
function readGroupData(root: JsonObject, limits: BbmodelLimits): Map<string, GroupData> {
  const byUuid = new Map<string, GroupData>();
  const value = field(root, 'groups');
  if (value === undefined) return byUuid;
  const groups = readArray(value, '$.groups', { max: limits.maxGroups, code: 'TOO_MANY_ELEMENTS', what: 'groups' });
  groups.forEach((item, index) => {
    const path = childPath('$.groups', index);
    const data = readObject(item, path);
    const uuid = readOptionalString(data, 'uuid', path, limits.maxStringChars, '');
    if (uuid === '') return;
    if (byUuid.has(uuid))
      throw new BbmodelError('DUPLICATE_REFERENCE', path, `group ${quoteValue(uuid)} appears twice`);
    byUuid.set(uuid, { data, path });
  });
  return byUuid;
}
