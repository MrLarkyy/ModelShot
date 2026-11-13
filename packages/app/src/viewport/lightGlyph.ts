import type { ScreenPoint } from './Projector';

/** The light helper stays this far inside the view, glyph included. */
export const LIGHT_INSET_PX = 16;
/** Reach of the arrow head and of the ring around the light's end, from the point they hang on. */
export const GLYPH_PX = 8;

export interface LightGlyph {
  /** The shaft from the light end to the arrow tip, clipped into the view; null when the helper is outside it. */
  readonly shaft: readonly [ScreenPoint, ScreenPoint] | null;
  /** The arrow tip (the shaft's far end, clipped with it), where the head is drawn; null without a shaft. */
  readonly head: ScreenPoint | null;
  /** The light end, where the ring is drawn; null when it lies outside the view. */
  readonly ring: ScreenPoint | null;
  /** Stands for the helper at the view's edge when it is wholly outside. */
  readonly marker: ScreenPoint | null;
  /** Where a hover over the helper is answered: the middle of what is drawn. */
  readonly anchor: ScreenPoint;
}

interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const inside = (p: ScreenPoint, r: Rect): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
const clampTo = (p: ScreenPoint, r: Rect): ScreenPoint => ({
  x: Math.min(r.maxX, Math.max(r.minX, p.x)),
  y: Math.min(r.maxY, Math.max(r.minY, p.y)),
});

// Liang-Barsky: the part of the segment a-b inside the rectangle, or null.
function clipSegment(a: ScreenPoint, b: ScreenPoint, r: Rect): [ScreenPoint, ScreenPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

/**
 * The key light's helper (a shaft from the light's end `a` to the arrow tip `b`) fitted into a `width` x `height` view:
 * everything drawn stays `LIGHT_INSET_PX` inside the edges, glyphs included. A helper wholly outside shows as a marker
 * at the edge nearest to it. Points that are not finite give no glyph.
 */
export function lightGlyph(a: ScreenPoint, b: ScreenPoint, width: number, height: number): LightGlyph | null {
  if (![a.x, a.y, b.x, b.y, width, height].every(Number.isFinite)) return null;
  const pad = LIGHT_INSET_PX + GLYPH_PX;
  const rect: Rect = { minX: pad, minY: pad, maxX: Math.max(pad, width - pad), maxY: Math.max(pad, height - pad) };
  const clipped = clipSegment(a, b, rect);
  if (!clipped) {
    const marker = clampTo(b, rect);
    return { shaft: null, head: null, ring: null, marker, anchor: marker };
  }
  const [from, to] = clipped;
  return {
    shaft: [from, to],
    head: to,
    ring: inside(a, rect) ? a : null,
    marker: null,
    anchor: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  };
}
