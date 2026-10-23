import {
  cameraBasis,
  cameraProjection,
  cameraRay,
  fitDistance,
  fitOrthoHeight,
  frameToFit,
  ISOMETRIC_PITCH_DEG,
  type SceneBounds,
} from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import {
  MAX_FOV_DEG,
  MAX_PITCH_DEG,
  MAX_ZOOM_OUT,
  MIN_DISTANCE_RADII,
  MIN_FOV_DEG,
  MIN_PITCH_DEG,
  OrbitController,
} from '../src/index';

const bounds: SceneBounds = { min: [-8, 0, -4], max: [8, 12, 4], center: [0, 6, 0], radius: Math.hypot(16, 12, 8) / 2 };

function controller(options: ConstructorParameters<typeof OrbitController>[0] = {}): OrbitController {
  const c = new OrbitController({ damping: false, ...options });
  c.setAspect(1.5);
  c.reset(bounds);
  return c;
}

describe('OrbitController', () => {
  it('reset frames the model exactly like frameToFit', () => {
    const c = controller({ yawDeg: 30, pitchDeg: 20 });
    const fitted = frameToFit(bounds, {
      projection: { kind: 'perspective', fovYDeg: 35 },
      aspect: 1.5,
      yawDeg: 30,
      pitchDeg: 20,
    });
    const camera = c.camera();
    camera.position.forEach((v, i) => expect(v).toBeCloseTo(fitted.position[i] ?? NaN, 9));
    expect(camera.target).toEqual(fitted.target);
    expect(camera.near).toBeCloseTo(fitted.near, 9);
    expect(camera.far).toBeCloseTo(fitted.far, 9);
    c.rotate(50, 10);
    c.zoom(0.5);
    c.pan(10, 10, 100);
    c.reset();
    c.camera().position.forEach((v, i) => expect(v).toBeCloseTo(fitted.position[i] ?? NaN, 9));
  });

  it('orbits around the target by the given angles', () => {
    const c = controller({ yawDeg: 0, pitchDeg: 0 });
    c.rotate(90, 0);
    const { forward } = cameraBasis(c.camera());
    [-1, 0, 0].forEach((v, i) => expect(forward[i]).toBeCloseTo(v, 12));
    expect(c.camera().target).toEqual(bounds.center);
  });

  it('clamps pitch short of the poles', () => {
    const c = controller();
    c.rotate(0, 500);
    expect(c.angles.pitchDeg).toBe(MAX_PITCH_DEG);
    c.rotate(0, -1000);
    expect(c.angles.pitchDeg).toBe(MIN_PITCH_DEG);
    expect(c.camera().position.every(Number.isFinite)).toBe(true);
  });

  it('dollies between the minimum and maximum distance', () => {
    const c = controller();
    const fit = fitDistance(bounds.radius, 35, 1.5);
    c.zoom(0.5);
    expect(c.distance).toBeCloseTo(fit * 0.5, 9);
    c.zoom(1e-9);
    expect(c.distance).toBeCloseTo(bounds.radius * MIN_DISTANCE_RADII, 9);
    c.zoom(1e9);
    expect(c.distance).toBeCloseTo(fit * MAX_ZOOM_OUT, 9);
    c.zoom(-1);
    c.zoom(NaN);
    expect(c.distance).toBeCloseTo(fit * MAX_ZOOM_OUT, 9);
  });

  it('keeps the whole model between near and far at every zoom', () => {
    const c = controller();
    for (const factor of [1e-9, 1, 1e9]) {
      c.zoom(factor);
      const camera = c.camera();
      const along = Math.hypot(...camera.position.map((p, i) => p - (bounds.center[i] ?? 0)));
      expect(camera.near).toBeGreaterThan(0);
      expect(camera.near).toBeLessThanOrEqual(along - bounds.radius);
      expect(camera.far).toBeGreaterThanOrEqual(along + bounds.radius);
    }
  });

  it('limits the orthographic height', () => {
    const c = controller({ projection: 'orthographic' });
    const fit = fitOrthoHeight(bounds.radius, 1.5);
    expect(c.orthoHeight).toBeCloseTo(fit, 9);
    c.zoom(1e-9);
    expect(c.orthoHeight).toBeCloseTo(fit / 16, 9);
    c.zoom(1e9);
    expect(c.orthoHeight).toBeCloseTo(fit * 8, 9);
    const camera = c.camera();
    expect(camera.projection).toEqual({ kind: 'orthographic', height: c.orthoHeight });
    expect(camera.near).toBeGreaterThan(0);
  });

  it('keeps the field of view in range and the apparent size at the target', () => {
    const c = controller();
    const heightAt = (): number => 2 * c.distance * Math.tan((c.fov * Math.PI) / 360);
    const before = heightAt();
    c.setFov(60);
    expect(c.fov).toBe(60);
    expect(heightAt()).toBeCloseTo(before, 9);
    c.setFov(1);
    expect(c.fov).toBe(MIN_FOV_DEG);
    c.setFov(500);
    expect(c.fov).toBe(MAX_FOV_DEG);
  });

  it('switches projection keeping the apparent size', () => {
    const c = controller();
    c.zoom(0.7);
    const height = 2 * c.distance * Math.tan((35 * Math.PI) / 360);
    c.setProjection('orthographic');
    expect(c.orthoHeight).toBeCloseTo(height, 9);
    c.setProjection('perspective');
    expect(2 * c.distance * Math.tan((35 * Math.PI) / 360)).toBeCloseTo(height, 9);
  });

  it('pans the target in the view plane by the pixel scale', () => {
    const c = controller({ yawDeg: 0, pitchDeg: 0 });
    const visible = 2 * c.distance * Math.tan((35 * Math.PI) / 360);
    c.pan(100, 0, 200);
    const target = c.camera().target;
    expect(target[0]).toBeCloseTo(-visible / 2, 9);
    expect(target[1]).toBeCloseTo(bounds.center[1], 9);
    c.pan(0, 100, 200);
    expect(c.camera().target[1]).toBeCloseTo(bounds.center[1] + visible / 2, 9);
  });

  it('isometric is orthographic at 45 and 35.264 degrees', () => {
    const c = controller();
    c.isometric();
    expect(c.projection).toBe('orthographic');
    expect(c.angles).toEqual({ yawDeg: 45, pitchDeg: ISOMETRIC_PITCH_DEG });
  });

  it('eases with damping and then stays bit-identical without input', () => {
    const c = new OrbitController({ damping: true });
    c.reset(bounds);
    c.rotate(40, 10);
    c.zoom(0.5);
    c.pan(30, -20, 300);
    expect(c.moving).toBe(true);
    const first = c.camera();
    c.update(16);
    expect(c.camera().position).not.toEqual(first.position);
    let steps = 0;
    while (c.update(16)) steps++;
    expect(steps).toBeLessThan(2000);
    const rest = JSON.stringify(c.camera());
    for (let i = 0; i < 10_000; i++) c.update(16);
    expect(JSON.stringify(c.camera())).toBe(rest);
  });

  it('changes nothing on update(0) or a non-finite step', () => {
    const c = new OrbitController({ damping: true });
    c.reset(bounds);
    c.rotate(40, 0);
    const before = JSON.stringify(c.camera());
    c.update(0);
    c.update(NaN);
    c.update(-5);
    expect(JSON.stringify(c.camera())).toBe(before);
  });

  it('ignores non-finite input so the camera stays defined', () => {
    const c = controller();
    const before = JSON.stringify(c.camera());
    for (const bad of [NaN, Infinity, -Infinity]) {
      c.rotate(bad, 0);
      c.rotate(0, bad);
      c.setAngles(bad, 10);
      c.setAngles(10, bad);
      c.frame(bad, 0);
      c.pan(bad, 0, 100);
      c.pan(0, 0, bad);
      c.zoom(bad);
      c.setFov(bad);
    }
    expect(JSON.stringify(c.camera())).toBe(before);
    const fromOptions = new OrbitController({ yawDeg: NaN, pitchDeg: Infinity, fovYDeg: NaN });
    expect(fromOptions.angles).toEqual({ yawDeg: 30, pitchDeg: 20 });
    expect(fromOptions.fov).toBe(35);
    expect(fromOptions.camera().position.every(Number.isFinite)).toBe(true);
  });

  it('uses the default damping time for a non-finite, zero or negative dampingMs', () => {
    const settle = (dampingMs?: number): string => {
      const c = new OrbitController(dampingMs === undefined ? { damping: true } : { damping: true, dampingMs });
      c.reset(bounds);
      c.rotate(40, 10);
      c.update(16);
      return JSON.stringify(c.camera());
    };
    const reference = settle();
    for (const bad of [NaN, Infinity, -Infinity, 0, -80]) {
      expect(settle(bad), String(bad)).toBe(reference);
    }
    expect(settle(160)).not.toBe(reference);
  });

  it('only ever produces a camera that projects', () => {
    const c = controller();
    for (const projection of ['perspective', 'orthographic'] as const) {
      c.setProjection(projection);
      for (const [fov, zoom] of [
        [0, 1e-12],
        [179.99, 1e12],
        [-5, 0.5],
      ] as const) {
        c.setFov(fov);
        c.zoom(zoom);
        const camera = c.camera();
        expect(() => cameraProjection(camera, 1.5)).not.toThrow();
        expect(() => cameraRay(camera, 1.5, 0.3, -0.2)).not.toThrow();
      }
    }
  });

  it('frames an empty scene with a default sphere', () => {
    const c = new OrbitController({ damping: false });
    c.reset(null);
    const camera = c.camera();
    expect(camera.position.every(Number.isFinite)).toBe(true);
    expect(camera.near).toBeGreaterThan(0);
  });

  describe('state / setState', () => {
    it('round trips a changed view exactly', () => {
      const a = controller({ yawDeg: 210 });
      a.rotate(33, -12);
      a.setFov(60);
      a.zoom(0.7);
      a.pan(40, -25, 600);
      const b = controller({ yawDeg: 30 });
      b.setState(a.state());
      expect(b.state()).toEqual(a.state());
      expectSameCamera(b, a);
    });

    it('round trips the orthographic view', () => {
      const a = controller();
      a.isometric();
      a.zoom(0.5);
      const b = controller();
      b.setState(a.state());
      expect(b.projection).toBe('orthographic');
      expectSameCamera(b, a);
    });

    it('restores the same view at another aspect of the viewport', () => {
      const a = controller();
      a.zoom(0.6);
      const b = controller();
      b.setAspect(0.8);
      b.reset(bounds);
      b.setState(a.state());
      expect(b.state().distance).toBeCloseTo(a.state().distance, 9);
    });

    it('ignores fields that are not finite, an unknown projection and a bad target', () => {
      const c = controller();
      const before = c.state();
      c.setState({
        yawDeg: NaN,
        pitchDeg: Infinity,
        fovYDeg: NaN,
        distance: -1,
        orthoHeight: NaN,
        target: [NaN, 0, 0],
        projection: 'fisheye' as 'perspective',
      });
      expect(c.state()).toEqual(before);
    });

    it('clamps out-of-range fields like the setters', () => {
      const c = controller();
      c.setState({ pitchDeg: 500, fovYDeg: 1000, distance: 1e9 });
      const state = c.state();
      expect(state.pitchDeg).toBe(MAX_PITCH_DEG);
      expect(state.fovYDeg).toBe(MAX_FOV_DEG);
      expect(state.distance).toBeLessThanOrEqual(MAX_ZOOM_OUT);
      expect(() => cameraProjection(c.camera(), 1.5)).not.toThrow();
    });

    it('applies a partial state and keeps the rest', () => {
      const c = controller();
      const before = c.state();
      c.setState({ yawDeg: 90 });
      expect(c.state()).toEqual({ ...before, yawDeg: 90 });
    });
  });
});

function expectSameCamera(actual: OrbitController, expected: OrbitController): void {
  const a = actual.camera();
  const e = expected.camera();
  a.position.forEach((v, i) => expect(v).toBeCloseTo(e.position[i] ?? 0, 9));
  a.target.forEach((v, i) => expect(v).toBeCloseTo(e.target[i] ?? 0, 9));
  expect(a.projection.kind).toBe(e.projection.kind);
}

describe('OrbitController initial angles', () => {
  it('resets to the angles set later, clamped, and ignores a non-finite pair', () => {
    const c = controller();
    c.reset(bounds);
    c.setInitialAngles(180, -120);
    c.rotate(33, 5);
    c.reset(bounds);
    expect(c.angles).toEqual({ yawDeg: 180, pitchDeg: MIN_PITCH_DEG });
    c.setInitialAngles(Number.NaN, 10);
    c.rotate(33, 5);
    c.reset(bounds);
    expect(c.angles).toEqual({ yawDeg: 180, pitchDeg: MIN_PITCH_DEG });
  });
});
