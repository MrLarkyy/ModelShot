import { resolveMaterialAlpha, type SceneAlphaMode, type SceneBlending, type SceneDocument } from '@modelshot/scene';
import type { SelectionTarget } from '../editor/Selection';

/** Elements listed for a selected group; the outliner holds the rest. */
export const MAX_GROUP_ELEMENTS = 100;

export interface MaterialInfo {
  readonly index: number;
  readonly name: string;
  /** Index into `SceneDocument.textures`, −1 for none. */
  readonly texture: number;
  readonly alphaMode: SceneAlphaMode;
  /** The cut-out threshold; null unless the mode cuts out. */
  readonly cutoff: number | null;
  readonly alphaEmission: boolean;
  readonly blending: SceneBlending;
  /** `Front`, `Both` or `Front and both` (an element whose faces differ). */
  readonly sides: string;
}

export interface GroupElement {
  readonly mesh: number;
  readonly materials: readonly string[];
}

export type MaterialState =
  | { readonly kind: 'none' }
  | { readonly kind: 'group'; readonly elements: readonly GroupElement[]; readonly total: number }
  | { readonly kind: 'element'; readonly mesh: number; readonly materials: readonly MaterialInfo[] };

const materialName = (doc: SceneDocument, index: number): string =>
  doc.materials[index]?.name || `Material ${index + 1}`;

/** The materials an element draws with, once each, in face-group order. */
export function elementMaterials(doc: SceneDocument, mesh: number): MaterialInfo[] {
  const groups = doc.meshes[mesh]?.groups ?? [];
  const out: MaterialInfo[] = [];
  const seen = new Set<number>();
  for (const group of groups) {
    const material = doc.materials[group.material];
    if (!material || seen.has(group.material)) continue;
    seen.add(group.material);
    const faces = groups.filter((g) => g.material === group.material);
    const both = faces.filter((g) => g.doubleSided === true).length;
    const rule = resolveMaterialAlpha(material);
    out.push({
      index: group.material,
      name: materialName(doc, group.material),
      texture: material.texture,
      alphaMode: rule.mode,
      cutoff: rule.mode === 'mask' ? rule.cutoff : null,
      alphaEmission: material.alphaEmission === true,
      blending: material.blending ?? 'normal',
      sides: both === 0 ? 'Front' : both === faces.length ? 'Both' : 'Front and both',
    });
  }
  return out;
}

/** What the Material tab shows for `target`: nothing selected, a group (its elements) or one element (its materials). */
export function materialState(doc: SceneDocument, target: SelectionTarget | null): MaterialState {
  if (!target) return { kind: 'none' };
  if (target.kind === 'mesh') {
    return doc.meshes[target.index]
      ? { kind: 'element', mesh: target.index, materials: elementMaterials(doc, target.index) }
      : { kind: 'none' };
  }
  if (!doc.nodes[target.index]) return { kind: 'none' };
  const elements: GroupElement[] = [];
  let total = 0;
  const pending = [target.index];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || visited.has(node)) continue;
    visited.add(node);
    const entry = doc.nodes[node];
    if (!entry) continue;
    for (const mesh of entry.meshes) {
      total += 1;
      if (elements.length < MAX_GROUP_ELEMENTS) {
        elements.push({ mesh, materials: elementMaterials(doc, mesh).map((m) => m.name) });
      }
    }
    for (let i = entry.children.length - 1; i >= 0; i--) pending.push(entry.children[i] as number);
  }
  return { kind: 'group', elements, total };
}
