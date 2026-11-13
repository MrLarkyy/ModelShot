import type { SceneCamera } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AXIS_BOX_PX } from '../src/viewport/axisPlacement';
import { OverlayRenderer } from '../src/viewport/OverlayRenderer';
import type { OverlayScene } from '../src/viewport/OverlayScene';

const points: { x: number; y: number }[] = [];

function fakeCanvas(): HTMLCanvasElement {
  const context = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'lineTo' || name === 'moveTo' || name === 'fillText') {
          return (...args: unknown[]) => {
            const [x, y] = name === 'fillText' ? [args[1], args[2]] : [args[0], args[1]];
            points.push({ x: x as number, y: y as number });
          };
        }
        return () => undefined;
      },
      set: () => true,
    },
  );
  return { getContext: () => context, width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

const camera = (x: number, y: number, z: number): SceneCamera => ({
  position: [x, y, z],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 40 },
  near: 0.1,
  far: 100,
});

const scene = (axis: boolean): OverlayScene => ({
  doc: null,
  selection: null,
  overlays: { grid: false, axis, stats: false, presets: true, gizmos: false },
  gizmo: null,
  keyDirection: null,
  activeAxis: null,
});

describe('OverlayRenderer axis gizmo', () => {
  beforeEach(() => {
    points.length = 0;
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000' }));
    vi.stubGlobal('document', { documentElement: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('draws inside a 56 px box that follows the insets, for every view direction', () => {
    const renderer = new OverlayRenderer(fakeCanvas());
    renderer.resize({ cssWidth: 400, cssHeight: 300, devicePixelRatio: 1 });
    renderer.setScene(scene(true));
    renderer.setInsets({ left: 70, bottom: 90 });
    for (const view of [camera(0, 0, 10), camera(10, 0, 0), camera(0, 10, 0.1), camera(5, 5, 5), camera(-6, 3, 4)]) {
      points.length = 0;
      renderer.draw(view);
      const bounds = renderer.axisBounds;
      expect(bounds).toEqual({ x: 70, y: 300 - 90 - AXIS_BOX_PX, width: AXIS_BOX_PX, height: AXIS_BOX_PX });
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(p.x).toBeLessThanOrEqual(bounds!.x + bounds!.width);
        expect(p.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(p.y).toBeLessThanOrEqual(bounds!.y + bounds!.height);
      }
    }
  });

  it('has no axis bounds while the gizmo is off', () => {
    const renderer = new OverlayRenderer(fakeCanvas());
    renderer.resize({ cssWidth: 400, cssHeight: 300, devicePixelRatio: 1 });
    renderer.setScene(scene(false));
    renderer.draw(camera(0, 0, 10));
    expect(renderer.axisBounds).toBeNull();
  });
});
