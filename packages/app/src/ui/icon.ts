export const ICON_NAMES = [
  'eye',
  'lock',
  'chevron-down',
  'chevron-right',
  'chevron-left',
  'chevron-up',
  'plus',
  'undo',
  'redo',
  'search',
  'cube',
  'sun',
  'camera',
  'play',
  'loop',
  'frame',
  'share',
  'download',
  'more',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

type Shape =
  | { readonly path: string }
  | { readonly circle: readonly [cx: number, cy: number, r: number] }
  | { readonly rect: readonly [x: number, y: number, width: number, height: number, radius: number] };

const path = (d: string): Shape => ({ path: d });
const circle = (cx: number, cy: number, r: number): Shape => ({ circle: [cx, cy, r] });

// Hand-drawn on a 16 px grid for a 1.7 px round stroke; no third-party set, so no licence and no dependency.
const SHAPES: Record<IconName, readonly Shape[]> = {
  eye: [path('M1.5 8C3 5 5.3 3.5 8 3.5S13 5 14.5 8C13 11 10.7 12.5 8 12.5S3 11 1.5 8Z'), circle(8, 8, 2.2)],
  lock: [{ rect: [3.5, 7, 9, 6.5, 1.5] }, path('M5.5 7V5a2.5 2.5 0 0 1 5 0v2')],
  'chevron-down': [path('M4 6l4 4 4-4')],
  'chevron-right': [path('M6 4l4 4-4 4')],
  'chevron-left': [path('M10 4L6 8l4 4')],
  'chevron-up': [path('M4 10l4-4 4 4')],
  plus: [path('M8 3v10M3 8h10')],
  undo: [path('M3.5 6.5h5.5a3.5 3.5 0 0 1 0 7H6'), path('M6 3.5l-2.5 3 2.5 3')],
  redo: [path('M12.5 6.5H7a3.5 3.5 0 0 0 0 7h3'), path('M10 3.5l2.5 3-2.5 3')],
  search: [circle(7, 7, 4.5), path('M10.5 10.5L14 14')],
  cube: [path('M8 1.8l5.5 3.1v6.2L8 14.2l-5.5-3.1V4.9z'), path('M2.5 4.9L8 8l5.5-3.1M8 8v6.2')],
  sun: [
    circle(8, 8, 2.8),
    path(
      'M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
    ),
  ],
  camera: [
    path('M2 5.5a1 1 0 0 1 1-1h1.8l1-1.5h4.4l1 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z'),
    circle(8, 8.5, 2.2),
  ],
  play: [path('M5 3.5v9l7-4.5z')],
  loop: [path('M3 7.5V7a3 3 0 0 1 3-3h6.5M10.5 2l2 2-2 2'), path('M13 8.5V9a3 3 0 0 1-3 3H3.5M5.5 14l-2-2 2-2')],
  frame: [
    path(
      'M2 5.5V3a1 1 0 0 1 1-1h2.5M10.5 2H13a1 1 0 0 1 1 1v2.5M14 10.5V13a1 1 0 0 1-1 1h-2.5M5.5 14H3a1 1 0 0 1-1-1v-2.5',
    ),
  ],
  share: [circle(4, 8, 1.8), circle(12, 4, 1.8), circle(12, 12, 1.8), path('M5.7 7.1l4.6-2.2M5.7 8.9l4.6 2.2')],
  download: [path('M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10')],
  more: [circle(3.5, 8, 1), circle(8, 8, 1), circle(12.5, 8, 1)],
};

const NS = 'http://www.w3.org/2000/svg';

function shapeElement(shape: Shape): SVGElement {
  if ('path' in shape) {
    const node = document.createElementNS(NS, 'path');
    node.setAttribute('d', shape.path);
    return node;
  }
  if ('circle' in shape) {
    const node = document.createElementNS(NS, 'circle');
    node.setAttribute('cx', String(shape.circle[0]));
    node.setAttribute('cy', String(shape.circle[1]));
    node.setAttribute('r', String(shape.circle[2]));
    return node;
  }
  const [x, y, width, height, radius] = shape.rect;
  const node = document.createElementNS(NS, 'rect');
  for (const [name, value] of Object.entries({ x, y, width, height, rx: radius }))
    node.setAttribute(name, String(value));
  return node;
}

/** A decorative 16 grid icon drawn with the current text colour; a button holding it carries its own label. */
export function icon(name: IconName, options: { readonly size?: 16 | 14 } = {}): SVGSVGElement {
  const shapes = SHAPES[name] as readonly Shape[] | undefined;
  if (!shapes) throw new Error(`Unknown icon "${String(name)}".`);
  const size = options.size ?? 16;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', size === 14 ? 'icon small' : 'icon');
  svg.setAttribute('data-icon', name);
  svg.append(...shapes.map(shapeElement));
  return svg;
}
