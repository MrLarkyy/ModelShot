export const AUTOROTATE_DEG_PER_S = 20;
const MAX_STEP_MS = 100;

/** What autorotate moves: the viewer's orbit controller (its public `rotate`) and the redraw request. */
export interface AutorotateTarget {
  readonly orbit: { rotate(deltaYawDeg: number, deltaPitchDeg: number): void };
  changed(): void;
}

export interface AutorotateOptions {
  /** Where user input stops the turning for good: the canvas. */
  readonly input: EventTarget;
  readonly matchMedia?: (query: string) => { readonly matches: boolean } & Partial<EventTarget>;
  readonly isHidden?: () => boolean;
  readonly requestFrame?: (callback: (time: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

const STOPPING_EVENTS = ['pointerdown', 'wheel', 'keydown'] as const;

/**
 * Turns the model about the vertical axis at 20 degrees a second, through `OrbitController.rotate`. Never starts under
 * prefers-reduced-motion and stops when it is set; stops for good on the first pointer, wheel or key input; pauses
 * while the page is hidden. Returns the stop function.
 */
export function startAutorotate(target: AutorotateTarget, options: AutorotateOptions): () => void {
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  const isHidden = options.isHidden ?? (() => document.hidden);
  const motion = (options.matchMedia ?? globalThis.matchMedia?.bind(globalThis))?.('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let last = -1;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelFrame(frame);
    for (const type of STOPPING_EVENTS) options.input.removeEventListener(type, stop, true);
    motion?.removeEventListener?.('change', onMotion);
  };
  const onMotion = (): void => {
    if (motion?.matches) stop();
  };
  const tick = (time: number): void => {
    if (stopped) return;
    if (isHidden()) {
      last = -1;
    } else {
      if (last >= 0) {
        const dt = Math.min(MAX_STEP_MS, Math.max(0, time - last));
        target.orbit.rotate((AUTOROTATE_DEG_PER_S * dt) / 1000, 0);
        target.changed();
      }
      last = time;
    }
    frame = requestFrame(tick);
  };
  if (motion?.matches) {
    stopped = true;
    return () => undefined;
  }
  for (const type of STOPPING_EVENTS) options.input.addEventListener(type, stop, true);
  motion?.addEventListener?.('change', onMotion);
  frame = requestFrame(tick);
  return stop;
}
