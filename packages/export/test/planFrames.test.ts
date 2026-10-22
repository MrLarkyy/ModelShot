import { fitRadius, orbitDirection, sceneBounds, type SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { checkExportOptions } from '../src/checkExportOptions';
import { planFrames } from '../src/planFrames';
import { CAMERA, cubeScene } from './support';

const doc = cubeScene();
const BASE = { width: 64, height: 64, camera: CAMERA, samples: 4, seed: 1 } as const;

const plan = (options: object) => planFrames(doc, checkExportOptions(doc, { ...BASE, ...options }));

/** Yaw of the camera around its target, degrees in [0, 360). */
function yawOf(camera: SceneCamera): number {
  const dx = camera.position[0] - camera.target[0];
  const dz = camera.position[2] - camera.target[2];
  return ((((Math.atan2(dx, dz) * 180) / Math.PI) % 360) + 360) % 360;
}

const distance = (c: SceneCamera): number =>
  Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);

describe('planFrames', () => {
  it('renders a still from the camera as given', () => {
    const frames = plan({ kind: 'still' });
    expect(frames).toHaveLength(1);
    expect(frames[0]?.camera).toEqual(CAMERA);
    expect(frames[0]?.document).toBe(doc);
  });

  it('turns a turntable through 360° in equal steps without repeating the first frame', () => {
    const frames = plan({ kind: 'turntable', format: 'apng', fps: 12, frames: 8 });
    expect(frames).toHaveLength(8);
    const yaws = frames.map((f) => yawOf(f.camera));
    yaws.forEach((yaw, i) => expect(yaw).toBeCloseTo((i * 45) % 360, 9));
    // One step past the last frame is the first again: the loop is seamless.
    expect((yaws.at(-1)! + 45) % 360).toBeCloseTo(yaws[0]!, 9);
    // Fitted: one distance for every frame, from the bounding sphere, the camera's pitch kept.
    const distances = frames.map((f) => distance(f.camera));
    for (const d of distances) expect(d).toBeCloseTo(distances[0]!, 9);
    const bounds = sceneBounds(doc)!;
    expect(distances[0]).toBeGreaterThan(fitRadius(bounds));
    const pitch = Math.atan2(2, 10);
    for (const f of frames) {
      const height = f.camera.position[1] - f.camera.target[1];
      expect(Math.asin(height / distance(f.camera))).toBeCloseTo(pitch, 9);
      expect(f.document).toBe(doc);
    }
  });

  it('orbits the camera itself with camera framing', () => {
    const frames = plan({ kind: 'turntable', format: 'gif', fps: 10, frames: 4, framing: 'camera' });
    expect(frames[0]?.camera.position).toEqual(CAMERA.position);
    const quarter = frames[1]!.camera.position;
    const expected = orbitDirection(90, (Math.atan2(2, 10) * 180) / Math.PI).map((v) => v * Math.hypot(2, 10));
    quarter.forEach((v, k) => expect(v).toBeCloseTo(expected[k]!, 9));
    for (const f of frames) expect(distance(f.camera)).toBeCloseTo(Math.hypot(2, 10), 9);
  });

  it('frames an animation with one camera around the union of every pose', () => {
    const frames = plan({ kind: 'animation', format: 'apng', fps: 4, animation: 'slide' });
    // 2 s at 4 fps of a loop: frame 8 would be frame 0 again.
    expect(frames.map((f) => f.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    const camera = frames[0]!.camera;
    for (const f of frames) expect(f.camera).toBe(camera);
    // The cube slides from x 0 to x 3.5 over the planned frames: the camera looks at the middle of all of them.
    const xs = frames.map((f) => sceneBounds(f.document)!.center[0]);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs.at(-1)).toBeCloseTo(3.5, 6);
    expect(camera.target[0]).toBeCloseTo(1.75, 6);
    // Every pose lies inside the sphere the camera frames.
    const union = { min: [-1, -1, -1], max: [4.5, 1, 1] };
    const radius = Math.hypot(5.5, 2, 2) / 2;
    for (const f of frames) {
      const b = sceneBounds(f.document)!;
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThanOrEqual(union.min[k]! - 1e-6);
        expect(b.max[k]).toBeLessThanOrEqual(union.max[k]! + 1e-6);
      }
    }
    expect(distance(camera)).toBeGreaterThan(radius);
    expect(frames[0]?.document).not.toBe(doc);
  });

  it('ends a hold clip on its last frame, as animationFrameTimes counts export frames', () => {
    const frames = plan({ kind: 'animation', format: 'apng', fps: 2, animation: 0, loop: 'hold' });
    expect(frames.map((f) => f.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(sceneBounds(frames.at(-1)!.document)!.center[0]).toBeCloseTo(4, 6);
  });

  it('keeps the given camera for an animation with camera framing', () => {
    const frames = plan({ kind: 'animation', format: 'apng', fps: 2, animation: 0, framing: 'camera', seconds: 1 });
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.camera).toEqual(CAMERA);
  });
});
