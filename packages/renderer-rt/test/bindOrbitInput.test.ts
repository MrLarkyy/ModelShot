import type { SceneBounds } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { bindOrbitInput, OrbitController, type OrbitInputElement } from '../src/index';

const bounds: SceneBounds = {
  min: [-8, 0, -8],
  max: [8, 16, 8],
  center: [0, 8, 0],
  radius: Math.hypot(16, 16, 16) / 2,
};

class FakeElement extends EventTarget implements OrbitInputElement {
  readonly clientHeight = 200;
  readonly attributes = new Map<string, string>();
  readonly captured = new Set<number>();
  readonly styles = new Map<string, string>();
  readonly style = { setProperty: (name: string, value: string): void => void this.styles.set(name, value) };
  listenerCount = 0;

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
    this.listenerCount++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
    this.listenerCount--;
    super.removeEventListener(...args);
  }
}

function fire(target: EventTarget, type: string, props: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), props);
  target.dispatchEvent(event);
  return event;
}

function setup(reducedMotion = false) {
  const element = new FakeElement();
  const controller = new OrbitController({ damping: false, yawDeg: 0, pitchDeg: 0 });
  controller.reset(bounds);
  let changes = 0;
  const dispose = bindOrbitInput(element, controller, {
    onChange: () => changes++,
    matchMedia: (query) => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' }),
  });
  return { element, controller, dispose, changes: () => changes };
}

const pointer = (pointerId: number, clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({
  pointerId,
  clientX,
  clientY,
  button: 0,
  shiftKey: false,
  ...extra,
});

describe('bindOrbitInput', () => {
  it('makes the element focusable and takes over touch gestures', () => {
    const { element } = setup();
    expect(element.getAttribute('tabindex')).toBe('0');
    expect(element.styles.get('touch-action')).toBe('none');
  });

  it('keeps an existing tabindex', () => {
    const element = new FakeElement();
    element.setAttribute('tabindex', '-1');
    bindOrbitInput(element, new OrbitController(), {
      onChange: () => undefined,
      matchMedia: () => ({ matches: false }),
    });
    expect(element.getAttribute('tabindex')).toBe('-1');
  });

  it('orbits on a left drag with pointer capture', () => {
    const { element, controller, changes } = setup();
    fire(element, 'pointerdown', pointer(1, 100, 100));
    expect(element.captured.has(1)).toBe(true);
    fire(element, 'pointermove', pointer(1, 110, 95));
    expect(controller.angles.yawDeg).toBeCloseTo(360 - 4, 9);
    expect(controller.angles.pitchDeg).toBeCloseTo(-2, 9);
    fire(element, 'pointerup', pointer(1, 110, 95));
    expect(element.captured.has(1)).toBe(false);
    fire(element, 'pointermove', pointer(1, 200, 200));
    expect(controller.angles.yawDeg).toBeCloseTo(356, 9);
    expect(changes()).toBe(1);
  });

  it('pans on a right, middle or shift drag', () => {
    for (const extra of [{ button: 2 }, { button: 1 }, { shiftKey: true }]) {
      const { element, controller } = setup();
      const before = controller.camera().target;
      fire(element, 'pointerdown', pointer(1, 50, 50, extra));
      fire(element, 'pointermove', pointer(1, 70, 50, extra));
      fire(element, 'pointerup', pointer(1, 70, 50));
      expect(controller.camera().target[0]).toBeLessThan(before[0]);
      expect(controller.angles.yawDeg).toBe(0);
    }
  });

  it('dollies on the wheel and prevents page scrolling', () => {
    const { element, controller } = setup();
    const before = controller.distance;
    const event = fire(element, 'wheel', { deltaY: -100, deltaMode: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(controller.distance).toBeCloseTo(before * Math.exp(-0.15), 9);
    fire(element, 'wheel', { deltaY: 3, deltaMode: 1 });
    expect(controller.distance).toBeCloseTo(before * Math.exp(-0.15 + 48 * 0.0015), 9);
  });

  it('pinch-zooms and two-finger pans', () => {
    const { element, controller } = setup();
    const distance = controller.distance;
    fire(element, 'pointerdown', pointer(1, 100, 100));
    fire(element, 'pointerdown', pointer(2, 200, 100));
    fire(element, 'pointermove', pointer(2, 300, 100));
    expect(controller.distance).toBeCloseTo(distance / 2, 9);
    expect(controller.angles.yawDeg).toBe(0);
    const target = controller.camera().target;
    fire(element, 'pointermove', pointer(1, 100, 140));
    fire(element, 'pointermove', pointer(2, 300, 140));
    expect(controller.camera().target[1]).toBeGreaterThan(target[1]);
    expect(controller.distance).toBeCloseTo(distance / 2, 9);
  });

  it('maps keys and prevents their default only when handled', () => {
    const { element, controller } = setup();
    expect(fire(element, 'keydown', { key: 'ArrowRight', shiftKey: false }).defaultPrevented).toBe(true);
    expect(controller.angles.yawDeg).toBe(7.5);
    fire(element, 'keydown', { key: 'ArrowUp', shiftKey: false });
    expect(controller.angles.pitchDeg).toBe(7.5);
    const distance = controller.distance;
    fire(element, 'keydown', { key: '+', shiftKey: true });
    expect(controller.distance).toBeCloseTo(distance / 1.15, 9);
    const target = controller.camera().target;
    fire(element, 'keydown', { key: 'ArrowLeft', shiftKey: true });
    expect(controller.camera().target).not.toEqual(target);
    fire(element, 'keydown', { key: 'o', shiftKey: false });
    expect(controller.projection).toBe('orthographic');
    fire(element, 'keydown', { key: 'i', shiftKey: false });
    expect(controller.angles.yawDeg).toBe(45);
    fire(element, 'keydown', { key: 'Home', shiftKey: false });
    expect(controller.angles).toEqual({ yawDeg: 0, pitchDeg: 0 });
    expect(fire(element, 'keydown', { key: 'a', shiftKey: false }).defaultPrevented).toBe(false);
    expect(fire(element, 'keydown', { key: 'ArrowLeft', ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('turns damping off under prefers-reduced-motion', () => {
    const element = new FakeElement();
    const controller = new OrbitController({ damping: true });
    bindOrbitInput(element, controller, { onChange: () => undefined, matchMedia: () => ({ matches: true }) });
    expect(controller.damping).toBe(false);
    const kept = new OrbitController({ damping: true });
    bindOrbitInput(new FakeElement(), kept, { onChange: () => undefined, matchMedia: () => ({ matches: false }) });
    expect(kept.damping).toBe(true);
  });

  it('follows changes of prefers-reduced-motion and stops listening on dispose', () => {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const query = {
      matches: false,
      addEventListener: (_: 'change', listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_: 'change', listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    };
    const controller = new OrbitController({ damping: true });
    const dispose = bindOrbitInput(new FakeElement(), controller, {
      onChange: () => undefined,
      matchMedia: () => query,
    });
    expect(controller.damping).toBe(true);
    for (const listener of listeners) listener({ matches: true });
    expect(controller.damping).toBe(false);
    for (const listener of listeners) listener({ matches: false });
    expect(controller.damping).toBe(true);
    dispose();
    expect(listeners.size).toBe(0);
  });

  it('keeps damping off for a controller created without it', () => {
    const query = { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined };
    const controller = new OrbitController({ damping: false });
    bindOrbitInput(new FakeElement(), controller, { onChange: () => undefined, matchMedia: () => query });
    expect(controller.damping).toBe(false);
  });

  it('dispose removes every listener', () => {
    const { element, controller, dispose, changes } = setup();
    expect(element.listenerCount).toBeGreaterThan(0);
    dispose();
    expect(element.listenerCount).toBe(0);
    fire(element, 'keydown', { key: 'ArrowRight', shiftKey: false });
    fire(element, 'wheel', { deltaY: 100, deltaMode: 0 });
    expect(controller.angles.yawDeg).toBe(0);
    expect(changes()).toBe(0);
  });
});
