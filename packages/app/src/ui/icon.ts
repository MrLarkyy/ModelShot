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
  'panel-left',
  'panel-right',
  'panel-bottom',
  'close',
  'eye-off',
  'unlock',
  'material',
  'look',
  'render',
  'keyframe',
  'folder',
  'check',
  'pause',
  'skip-start',
  'key-prev',
  'key-next',
  'move',
  'rotate',
  'help',
  'zoom-in',
  'zoom-out',
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
  'panel-left': [{ rect: [2, 2.5, 12, 11, 1.5] }, path('M6.5 2.5v11')],
  'panel-right': [{ rect: [2, 2.5, 12, 11, 1.5] }, path('M9.5 2.5v11')],
  'panel-bottom': [{ rect: [2, 2.5, 12, 11, 1.5] }, path('M2 9.5h12')],
  close: [path('M3.5 3.5l9 9M12.5 3.5l-9 9')],
  'eye-off': [path('M1.5 8C3 5 5.3 3.5 8 3.5S13 5 14.5 8C13 11 10.7 12.5 8 12.5S3 11 1.5 8Z'), path('M2.5 2.5l11 11')],
  unlock: [{ rect: [3.5, 7, 9, 6.5, 1.5] }, path('M5.5 7V5a2.5 2.5 0 0 1 4.8-1')],
  material: [circle(8, 8, 5.5), path('M8 2.5a5.5 5.5 0 0 0 0 11'), path('M2.6 7h10.8')],
  look: [path('M2.5 13.5l6-6'), path('M9.5 3.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z')],
  render: [{ rect: [2, 3, 12, 9, 1.5] }, path('M6.5 6v3.5l3-1.75zM5 14h6')],
  keyframe: [path('M8 2.5l5 5.5-5 5.5L3 8z')],
  check: [path('M3 8.5l3.2 3.2L13 4.8')],
  pause: [path('M5.5 3.5v9M10.5 3.5v9')],
  'skip-start': [path('M3.5 3v10'), path('M12.5 3.5v9L6 8z')],
  'key-prev': [path('M3 3v10'), path('M10 4.5L6.5 8l3.5 3.5'), path('M13 4.5L9.5 8l3.5 3.5')],
  'key-next': [path('M13 3v10'), path('M6 4.5L9.5 8 6 11.5'), path('M3 4.5L6.5 8 3 11.5')],
  move: [path('M8 1.8v12.4M1.8 8h12.4'), path('M6 3.8L8 1.8l2 2M6 12.2l2 2 2-2M3.8 6L1.8 8l2 2M12.2 6l2 2-2 2')],
  rotate: [path('M13 8a5 5 0 1 1-1.8-3.8'), path('M13 2.5v2.8h-2.8')],
  help: [circle(8, 8, 6), path('M6.2 6.3a1.9 1.9 0 1 1 2.9 1.6C8.4 8.4 8 8.8 8 9.6'), path('M8 11.6v.1')],
  'zoom-in': [circle(7, 7, 4.5), path('M10.5 10.5L14 14M5 7h4M7 5v4')],
  'zoom-out': [circle(7, 7, 4.5), path('M10.5 10.5L14 14M5 7h4')],
  folder: [path('M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z')],
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
