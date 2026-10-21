import { tokens } from '../tokens';

export const MARK_VARIANTS = ['primary', 'inverse', 'mono', 'favicon16', 'favicon32', 'appIcon'] as const;
export type MarkVariant = (typeof MARK_VARIANTS)[number];

type Point = readonly [number, number];

interface MarkGeometry {
  readonly radius: number;
  readonly top: readonly Point[];
  readonly left: readonly Point[];
  readonly right: readonly Point[];
  readonly dot: number;
}

// The 132 grid of the logo system canvas (CLogo): tile, isometric cube, flash dot at (104, 28).
const SIZE = 132;
const DOT_X = 104;
const DOT_Y = 28;

const STANDARD: MarkGeometry = {
  radius: 34,
  top: [
    [66, 30],
    [100, 49],
    [66, 68],
    [32, 49],
  ],
  left: [
    [32, 49],
    [66, 68],
    [66, 106],
    [32, 87],
  ],
  right: [
    [66, 68],
    [100, 49],
    [100, 87],
    [66, 106],
  ],
  dot: 12,
};

// At 16 px the dot drops and the cube fills more of the tile.
const FAVICON_16: MarkGeometry = {
  radius: 30,
  top: [
    [66, 24],
    [108, 48],
    [66, 72],
    [24, 48],
  ],
  left: [
    [24, 48],
    [66, 72],
    [66, 116],
    [24, 92],
  ],
  right: [
    [66, 72],
    [108, 48],
    [108, 92],
    [66, 116],
  ],
  dot: 0,
};

const MONO_GAP = 6;
const MONO_RING = 4;

const { color } = tokens;

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function signedArea(polygon: readonly Point[]): number {
  let area = 0;
  polygon.forEach(([x0, y0], i) => {
    const [x1, y1] = polygon[(i + 1) % polygon.length]!;
    area += x0 * y1 - x1 * y0;
  });
  return area / 2;
}

// Moves every edge of a convex polygon inwards by `distance`; the new corners are where neighbouring edges meet.
function insetPolygon(polygon: readonly Point[], distance: number): Point[] {
  const sign = signedArea(polygon) > 0 ? 1 : -1;
  const n = polygon.length;
  const lines = polygon.map(([x0, y0], i) => {
    const [x1, y1] = polygon[(i + 1) % n]!;
    const length = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / length) * sign;
    const ny = ((x1 - x0) / length) * sign;
    return { x: x0 + nx * distance, y: y0 + ny * distance, dx: x1 - x0, dy: y1 - y0 };
  });
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n]!;
    const denominator = prev.dx * line.dy - prev.dy * line.dx;
    const t = ((line.x - prev.x) * line.dy - (line.y - prev.y) * line.dx) / denominator;
    return [prev.x + prev.dx * t, prev.y + prev.dy * t] as const;
  });
}

function roundedSquarePath(radius: number): string {
  const r = num(radius);
  const far = num(SIZE - radius);
  return `M${r} 0H${far}A${r} ${r} 0 0 1 ${SIZE} ${r}V${far}A${r} ${r} 0 0 1 ${far} ${SIZE}H${r}A${r} ${r} 0 0 1 0 ${far}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

function circlePath(r: number): string {
  return `M${num(DOT_X - r)} ${DOT_Y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

function polygonPath(polygon: readonly Point[]): string {
  return `M${polygon.map(([x, y]) => `${num(x)} ${num(y)}`).join('L')}Z`;
}

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>\n`;
}

function colouredMark(geometry: MarkGeometry, palette: readonly [string, string, string, string]): string {
  const [tile, top, left, right] = palette;
  const rx = geometry.radius > 0 ? ` rx="${geometry.radius}"` : '';
  const dot = geometry.dot > 0 ? `<circle cx="${DOT_X}" cy="${DOT_Y}" r="${geometry.dot}" fill="${color.flash}"/>` : '';
  return svg(
    `<rect width="${SIZE}" height="${SIZE}"${rx} fill="${tile}"/>` +
      `<path fill="${top}" d="${polygonPath(geometry.top)}"/>` +
      `<path fill="${left}" d="${polygonPath(geometry.left)}"/>` +
      `<path fill="${right}" d="${polygonPath(geometry.right)}"/>` +
      dot,
  );
}

// One colour: the faces are holes in the tile, kept apart by MONO_GAP, and the dot sits in a knocked-out ring.
function monoMark(): string {
  const faces = [STANDARD.top, STANDARD.left, STANDARD.right].map((face) =>
    polygonPath(insetPolygon(face, MONO_GAP / 2)),
  );
  const d = [
    roundedSquarePath(STANDARD.radius),
    ...faces,
    circlePath(STANDARD.dot + MONO_RING),
    circlePath(STANDARD.dot),
  ].join('');
  return svg(`<path fill="currentColor" fill-rule="evenodd" d="${d}"/>`);
}

const PRIMARY = [color.shotBlue, color.paper, color.blueTint, color.blueMid] as const;
const INVERSE = [color.paper, color.blueMid, color.shotBlue, color.blueDeep] as const;

export function markSvg(variant: MarkVariant): string {
  switch (variant) {
    case 'primary':
      return colouredMark(STANDARD, PRIMARY);
    case 'inverse':
      return colouredMark(STANDARD, INVERSE);
    case 'mono':
      return monoMark();
    case 'favicon16':
      return colouredMark(FAVICON_16, PRIMARY);
    case 'favicon32':
      return colouredMark({ ...STANDARD, dot: 14 }, PRIMARY);
    case 'appIcon':
      return colouredMark({ ...STANDARD, radius: 0 }, PRIMARY);
  }
}
