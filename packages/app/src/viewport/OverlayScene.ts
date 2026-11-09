import type { SceneDocument, Vec3 } from '@modelshot/scene';
import type { SelectionTarget } from '../editor/Selection';
import type { OverlayId } from '../layout/layoutState';
import type { GizmoMode } from './gizmoFrame';

/** What the overlay draws on top of the preview. */
export interface OverlayScene {
  readonly doc: SceneDocument | null;
  readonly selection: SelectionTarget | null;
  readonly overlays: Readonly<Record<OverlayId, boolean>>;
  /** The node the move or rotate gizmo stands on and its mode; null: no gizmo (nothing selected, locked, no node). */
  readonly gizmo: { readonly node: number; readonly mode: GizmoMode } | null;
  /** World direction toward the look's key light, drawn as an arrow. */
  readonly keyDirection: Vec3 | null;
  /** The handle being dragged, drawn bright. */
  readonly activeAxis: 0 | 1 | 2 | null;
}
