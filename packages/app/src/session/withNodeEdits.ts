import type { SceneDocument, SceneNode, Vec3 } from '@modelshot/scene';
import type { NodeEdit } from './NodeEdit';

const restRotation = (node: SceneNode): Vec3 => node.restRotation ?? node.rotation;

function byNode(edits: readonly NodeEdit[]): Map<number, NodeEdit> {
  return new Map(edits.map((edit) => [edit.node, edit]));
}

/**
 * `doc` (the rest pose, or a pose of it) with the node edits applied on top of its own transforms. `restRotation` of an
 * edited node stays the rest of `rest`, so the renderer sees a pose change: the meshes, materials and textures arrays
 * and the nodes' rest are the ones it already has, and the move costs no decode or upload.
 */
export function withNodeEdits(doc: SceneDocument, rest: SceneDocument, edits: readonly NodeEdit[]): SceneDocument {
  if (edits.length === 0) return doc;
  const edit = byNode(edits);
  let changed = false;
  const nodes = doc.nodes.map((node, i) => {
    const e = edit.get(i);
    const base = rest.nodes[i];
    if (!e || !base) return node;
    changed = true;
    const rot = restRotation(base);
    return {
      ...node,
      rotation: [
        node.rotation[0] + e.rotation[0] - rot[0],
        node.rotation[1] + e.rotation[1] - rot[1],
        node.rotation[2] + e.rotation[2] - rot[2],
      ] as Vec3,
      restRotation: rot,
      translation: [
        node.translation[0] + e.translation[0] - base.translation[0],
        node.translation[1] + e.translation[1] - base.translation[1],
        node.translation[2] + e.translation[2] - base.translation[2],
      ] as Vec3,
    };
  });
  return changed ? { ...doc, nodes } : doc;
}

function omitRestRotation(node: SceneNode): SceneNode {
  const copy: Partial<Record<keyof SceneNode, unknown>> = { ...node };
  delete copy.restRotation;
  return copy as unknown as SceneNode;
}

/** The rest pose with the edits as the rest itself: what an animation export animates from. */
export function bakeNodeEdits(rest: SceneDocument, edits: readonly NodeEdit[]): SceneDocument {
  if (edits.length === 0) return rest;
  const edit = byNode(edits);
  const nodes = rest.nodes.map((node, i) => {
    const e = edit.get(i);
    if (!e) return node;
    // The edit is the rest itself: no separate rest rotation, so an animation starts from the edited angles.
    const edited: SceneNode = { ...node, rotation: e.rotation, translation: e.translation };
    return Object.hasOwn(edited, 'restRotation') ? omitRestRotation(edited) : edited;
  });
  return { ...rest, nodes };
}

/** `edits` with `edit` set for its node (replacing an earlier one); an edit equal to the rest is dropped. */
export function setNodeEdit(rest: SceneDocument, edits: readonly NodeEdit[], edit: NodeEdit): NodeEdit[] {
  const base = rest.nodes[edit.node];
  const others = edits.filter((e) => e.node !== edit.node);
  if (!base) return others;
  const same = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  if (same(edit.translation, base.translation) && same(edit.rotation, restRotation(base))) return others;
  return [...others, edit].sort((a, b) => a.node - b.node);
}

/** The edit of `node` or its rest transform. */
export function nodeTransform(rest: SceneDocument, edits: readonly NodeEdit[], node: number): NodeEdit | null {
  const base = rest.nodes[node];
  if (!base) return null;
  return edits.find((e) => e.node === node) ?? { node, translation: base.translation, rotation: restRotation(base) };
}
