import type { SceneDocument } from '@modelshot/scene';

/** Longest label the user can give a node or element. */
export const MAX_NAME_LENGTH = 128;

export type NameKey = `n:${number}` | `m:${number}`;

export function nameKey(kind: 'node' | 'mesh', index: number): NameKey {
  return kind === 'node' ? `n:${index}` : `m:${index}`;
}

/** The label of a node or element: the user's rename, else the file's name, else a numbered fallback. */
export function displayName(
  doc: SceneDocument,
  names: ReadonlyMap<string, string>,
  kind: 'node' | 'mesh',
  index: number,
): string {
  const own = names.get(nameKey(kind, index));
  if (own) return own;
  const fromFile = kind === 'node' ? doc.nodes[index]?.name : doc.meshes[index]?.name;
  return fromFile || `${kind === 'node' ? 'Group' : 'Element'} ${index + 1}`;
}
