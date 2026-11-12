import type { SceneDocument } from '@modelshot/scene';
import { displayName } from '../editor/displayName';
import type { SelectionTarget } from '../editor/Selection';

/** Rows listed; a larger scene lists the first ones and says how many are left out. */
export const MAX_SCENE_ROWS = 500;

export interface OutlinerRow {
  readonly kind: 'node' | 'mesh';
  readonly index: number;
  /** 0 for a root. */
  readonly depth: number;
  readonly hasChildren: boolean;
  /** Shown open: not collapsed, or opened by a search that matches below it. */
  readonly expanded: boolean;
  /** The selected row lies below this group. */
  readonly ancestorOfSelected: boolean;
  /** `[start, end)` ranges of the label that match the search, ascending and apart. */
  readonly matchRanges: readonly (readonly [number, number])[];
}

export interface OutlinerRows {
  readonly rows: readonly OutlinerRow[];
  /** Rows visible before the cap (after collapse and search). */
  readonly total: number;
  readonly shown: number;
}

/** The ranges of `label` that hold `query` (already lower case), case-insensitively and without overlap. */
export function matchRanges(label: string, query: string): (readonly [number, number])[] {
  if (query === '') return [];
  const lower = label.toLowerCase();
  const out: [number, number][] = [];
  for (let at = lower.indexOf(query); at >= 0; at = lower.indexOf(query, at + query.length)) {
    out.push([at, at + query.length]);
  }
  return out;
}

interface Frame {
  readonly kind: 'node' | 'mesh';
  readonly index: number;
  readonly depth: number;
}

/**
 * The visible rows of the outliner, flat and in order: groups with their sub-groups and elements, elements outside any
 * group last. A collapsed group hides what is below it; a search keeps the matching rows and the groups above them and
 * shows those groups open, without touching `collapsed`. Iterative, so a deeply nested file cannot overflow the stack.
 */
export function outlinerRows(
  doc: SceneDocument,
  names: ReadonlyMap<string, string>,
  collapsed: ReadonlySet<number>,
  query: string,
  selection: SelectionTarget | null,
  max: number = MAX_SCENE_ROWS,
): OutlinerRows {
  const needle = query.trim().toLowerCase();
  const ranges = (kind: 'node' | 'mesh', index: number): (readonly [number, number])[] =>
    needle === '' ? [] : matchRanges(displayName(doc, names, kind, index), needle);

  // With a search: which nodes hold a match (themselves or below). A parent's index is lower than its children's, so one
  // pass from the last node to the first carries a match up through every level.
  let keepNode: boolean[] | null = null;
  let keepMesh: boolean[] | null = null;
  if (needle !== '') {
    const meshes = doc.meshes.map((_, index) => ranges('mesh', index).length > 0);
    const nodes = doc.nodes.map(
      (node, index) => ranges('node', index).length > 0 || node.meshes.some((m) => meshes[m]),
    );
    for (let index = doc.nodes.length - 1; index >= 0; index--) {
      const parent = doc.nodes[index]?.parent ?? -1;
      if (nodes[index] && parent >= 0 && parent < index) nodes[parent] = true;
    }
    keepMesh = meshes;
    keepNode = nodes;
  }
  const kept = (kind: 'node' | 'mesh', index: number): boolean =>
    needle === '' || (kind === 'node' ? keepNode?.[index] === true : keepMesh?.[index] === true);

  // The groups above the selection.
  const above = new Set<number>();
  if (selection) {
    let at =
      selection.kind === 'node'
        ? (doc.nodes[selection.index]?.parent ?? -1)
        : (doc.meshes[selection.index]?.node ?? -1);
    for (let guard = 0; at >= 0 && guard <= doc.nodes.length; guard++) {
      above.add(at);
      at = doc.nodes[at]?.parent ?? -1;
    }
  }

  const rows: OutlinerRow[] = [];
  let total = 0;
  const visit = (
    kind: 'node' | 'mesh',
    index: number,
    depth: number,
    hasChildren: boolean,
    expanded: boolean,
  ): void => {
    total += 1;
    if (rows.length >= max) return;
    rows.push({
      kind,
      index,
      depth,
      hasChildren,
      expanded,
      ancestorOfSelected: kind === 'node' && above.has(index),
      matchRanges: ranges(kind, index),
    });
  };

  const stack: Frame[] = [];
  const push = (frame: Frame): void => {
    const exists = frame.kind === 'node' ? doc.nodes[frame.index] : doc.meshes[frame.index];
    if (exists && kept(frame.kind, frame.index)) stack.push(frame);
  };
  const roots: Frame[] = doc.rootNodes.map((index) => ({ kind: 'node', index, depth: 0 }));
  doc.meshes.forEach((mesh, index) => {
    if (mesh.node < 0) roots.push({ kind: 'mesh', index, depth: 0 });
  });
  for (let i = roots.length - 1; i >= 0; i--) push(roots[i] as Frame);

  const seen = new Set<number>();
  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    if (frame.kind === 'mesh') {
      visit('mesh', frame.index, frame.depth, false, false);
      continue;
    }
    if (seen.has(frame.index)) continue;
    seen.add(frame.index);
    const node = doc.nodes[frame.index];
    if (!node) continue;
    const depth = frame.depth + 1;
    const children: Frame[] = [
      ...node.children.map((index): Frame => ({ kind: 'node', index, depth })),
      ...node.meshes.map((index): Frame => ({ kind: 'mesh', index, depth })),
    ];
    const hasChildren = children.length > 0;
    const below = children.filter((child) => doc.nodes[child.index] !== undefined || child.kind === 'mesh');
    const expanded =
      hasChildren && (needle !== '' ? below.some((c) => kept(c.kind, c.index)) : !collapsed.has(frame.index));
    visit('node', frame.index, frame.depth, hasChildren, expanded);
    if (!expanded) continue;
    for (let i = children.length - 1; i >= 0; i--) push(children[i] as Frame);
  }
  return { rows, total, shown: rows.length };
}
