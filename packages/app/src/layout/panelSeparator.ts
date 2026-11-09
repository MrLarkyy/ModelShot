export interface SeparatorOptions {
  readonly element: HTMLElement;
  readonly orientation: 'vertical' | 'horizontal';
  readonly min: number;
  readonly max: number;
  /** Pixels per arrow key press. */
  readonly step?: number;
  /** +1 when a pointer move towards the right or the bottom makes the panel larger, -1 when smaller. */
  readonly direction: 1 | -1;
  readonly value: () => number;
  readonly onResize: (px: number) => void;
}

const KEY_STEP = 16;

// A focusable separator that resizes the panel next to it with the pointer and with the arrow, Home and End keys, and
// reports its size to assistive technology.
export function bindSeparator(options: SeparatorOptions): { sync: () => void; dispose: () => void } {
  const { element, orientation, min, max, direction } = options;
  const step = options.step ?? KEY_STEP;
  const clamp = (px: number): number => Math.min(max, Math.max(min, Math.round(px)));
  const sync = (): void => {
    element.setAttribute('aria-valuemin', String(min));
    element.setAttribute('aria-valuemax', String(max));
    element.setAttribute('aria-valuenow', String(clamp(options.value())));
  };
  const set = (px: number): void => {
    options.onResize(clamp(px));
    sync();
  };
  let drag: { readonly from: number; readonly start: number } | null = null;
  const axis = (e: PointerEvent): number => (orientation === 'vertical' ? e.clientX : e.clientY);
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    drag = { from: axis(e), start: options.value() };
    element.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (drag) set(drag.start + (axis(e) - drag.from) * direction);
  };
  const onUp = (e: PointerEvent): void => {
    drag = null;
    element.releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: KeyboardEvent): void => {
    const grow =
      orientation === 'vertical'
        ? direction === 1
          ? 'ArrowRight'
          : 'ArrowLeft'
        : direction === 1
          ? 'ArrowDown'
          : 'ArrowUp';
    const shrink =
      orientation === 'vertical'
        ? direction === 1
          ? 'ArrowLeft'
          : 'ArrowRight'
        : direction === 1
          ? 'ArrowUp'
          : 'ArrowDown';
    if (e.key === grow) set(options.value() + step);
    else if (e.key === shrink) set(options.value() - step);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
  };
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);
  element.addEventListener('keydown', onKey);
  sync();
  return {
    sync,
    dispose: () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      element.removeEventListener('keydown', onKey);
    },
  };
}
