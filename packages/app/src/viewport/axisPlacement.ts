export interface PlacedBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface AxisInsets {
  /** Distance of the axis box from the view's left edge. */
  readonly left: number;
  /** Distance of the axis box from the view's bottom edge. */
  readonly bottom: number;
}

/** Side of the axis gizmo's box in CSS px. */
export const AXIS_BOX_PX = 56;
const MARGIN_PX = 12;
const GAP_PX = 8;

const intersects = (a: PlacedBox, b: PlacedBox, gap: number): boolean =>
  a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

/**
 * Where the axis gizmo's box stands in a view of `width` x `height` CSS px: the bottom-left corner, moved off every
 * obstacle (boxes in the view's own coordinates). An obstacle in the lower half raises the box above it, one in the
 * upper half pushes it right.
 */
export function placeAxisBox(width: number, height: number, obstacles: readonly PlacedBox[]): AxisInsets {
  let left = MARGIN_PX;
  let bottom = MARGIN_PX;
  for (let pass = 0; pass <= obstacles.length; pass++) {
    const box: PlacedBox = {
      left,
      right: left + AXIS_BOX_PX,
      top: height - bottom - AXIS_BOX_PX,
      bottom: height - bottom,
    };
    const hit = obstacles.find((obstacle) => intersects(box, obstacle, GAP_PX));
    if (!hit) break;
    if ((hit.top + hit.bottom) / 2 > height / 2) bottom = Math.max(bottom, height - hit.top + GAP_PX);
    else left = Math.max(left, hit.right + GAP_PX);
  }
  return {
    left: Math.max(0, Math.min(left, width - AXIS_BOX_PX)),
    bottom: Math.max(0, Math.min(bottom, height - AXIS_BOX_PX)),
  };
}
