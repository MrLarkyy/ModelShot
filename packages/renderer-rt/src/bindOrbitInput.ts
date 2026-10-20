import type { OrbitController } from './OrbitController';
import { orbitKeyAction } from './orbitKeys';

/** The parts of an element the binding uses (an `HTMLElement` or `HTMLCanvasElement` fits). */
export interface OrbitInputElement extends EventTarget {
  readonly clientHeight: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  readonly style?: { setProperty(name: string, value: string): void };
}

export interface BindOrbitInputOptions {
  /** Called after every change: the caller renders, and keeps calling `update` while `controller.moving`. */
  readonly onChange: () => void;
  /** Degrees of orbit per dragged pixel. Default 0.4. */
  readonly rotateDegPerPixel?: number;
  /** Media query source for prefers-reduced-motion; default `globalThis.matchMedia`. */
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

interface PointerPosition {
  x: number;
  y: number;
}

const WHEEL_ZOOM_PER_PIXEL = 0.0015;
const WHEEL_LINE_PX = 16;

/**
 * Mouse, touch (through pointer events) and keyboard input for an `OrbitController`: left drag orbits; right,
 * middle or Shift + left drag pans; the wheel dollies; one finger orbits, two fingers pinch-zoom and pan; keys work
 * on the focused element (it gets `tabindex="0"` when it has none). Damping is switched off under
 * prefers-reduced-motion. Returns a function that removes every listener.
 */
export function bindOrbitInput(
  element: OrbitInputElement,
  controller: OrbitController,
  options: BindOrbitInputOptions,
): () => void {
  const rotateDeg = options.rotateDegPerPixel ?? 0.4;
  const matchMedia = options.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) controller.damping = false;
  if (element.getAttribute('tabindex') === null) element.setAttribute('tabindex', '0');
  element.style?.setProperty('touch-action', 'none');

  const pointers = new Map<number, PointerPosition>();
  let panDrag = false;
  const height = (): number => Math.max(1, element.clientHeight);
  const changed = (): void => options.onChange();

  const centroid = (): PointerPosition & { spread: number } => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return { x: a?.x ?? 0, y: a?.y ?? 0, spread: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  const onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (pointers.size >= 2) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panDrag = e.button === 1 || e.button === 2 || e.shiftKey;
    element.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    if (pointers.size === 1) {
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      previous.x = e.clientX;
      previous.y = e.clientY;
      if (panDrag) controller.pan(dx, dy, height());
      else controller.rotate(-dx * rotateDeg, dy * rotateDeg);
      changed();
      return;
    }
    const before = centroid();
    previous.x = e.clientX;
    previous.y = e.clientY;
    const after = centroid();
    controller.pan(after.x - before.x, after.y - before.y, height());
    if (before.spread > 0 && after.spread > 0) controller.zoom(before.spread / after.spread);
    changed();
  };

  const onPointerEnd = (event: Event): void => {
    const e = event as PointerEvent;
    if (!pointers.delete(e.pointerId)) return;
    element.releasePointerCapture?.(e.pointerId);
  };

  const onWheel = (event: Event): void => {
    const e = event as WheelEvent;
    e.preventDefault();
    const pixels = e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaMode === 2 ? e.deltaY * height() : e.deltaY;
    controller.zoom(Math.exp(pixels * WHEEL_ZOOM_PER_PIXEL));
    changed();
  };

  const onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const action = orbitKeyAction(e.key, e.shiftKey);
    if (!action) return;
    e.preventDefault();
    switch (action.kind) {
      case 'rotate':
        controller.rotate(action.yawDeg, action.pitchDeg);
        break;
      case 'pan':
        controller.pan(action.dxPx, action.dyPx, height());
        break;
      case 'zoom':
        controller.zoom(action.factor);
        break;
      case 'reset':
        controller.reset();
        break;
      case 'toggleProjection':
        controller.setProjection(controller.projection === 'perspective' ? 'orthographic' : 'perspective');
        break;
      case 'isometric':
        controller.isometric();
        break;
    }
    changed();
  };

  const onContextMenu = (event: Event): void => event.preventDefault();

  const listeners: [string, (event: Event) => void, AddEventListenerOptions?][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerEnd],
    ['pointercancel', onPointerEnd],
    ['wheel', onWheel, { passive: false }],
    ['keydown', onKeyDown],
    ['contextmenu', onContextMenu],
  ];
  for (const [type, listener, listenerOptions] of listeners) element.addEventListener(type, listener, listenerOptions);
  return () => {
    for (const [type, listener] of listeners) element.removeEventListener(type, listener);
    pointers.clear();
  };
}
