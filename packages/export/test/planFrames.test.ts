import { fitRadius, orbitDirection, sceneBounds, type SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { checkExportOptions, type CheckedAnimationOptions } from '../src/checkExportOptions';
import { framePose } from '../src/framePose';
import { planFrames } from '../src/planFrames';
import { CAMERA, cubeScene } from './support';

const doc = cubeScene();
const BASE = { width: 64, height: 64, camera: CAMERA, samples: 4, seed: 1 } as const;

const checked = (options: object) => checkExportOptions(doc, { ...BASE, ...options });
const plan = (options: object, signal?: AbortSignal) => planFrames(doc, checked(options), signal);

/** Yaw of the camera around its target, degrees in [0, 360). */
function yawOf(camera: SceneCamera): number {
  const dx = camera.position[0] - camera.target[0];
  const dz = camera.position[2] - camera.target[2];
  return ((((Math.atan2(dx, dz) * 180) / Math.PI) % 360) + 360) % 360;
}

const distance = (c: SceneCamera): number =>
  Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);

describe('planFrames', () => {
  it('renders a still from the camera as given', async () => {
    const { frames, catcherBounds } = await plan({ kind: 'still' });
    expect(frames).toEqual([{ index: 0, camera: CAMERA, time: 0 }]);
    expect(catcherBounds).toBeNull();
  });

  it('turns a turntable through 360° in equal steps without repeating the first frame', async () => {
    const { frames, catcherBounds } = await plan({ kind: 'turntable', format: 'apng', fps: 12, frames: 8 });
    expect(frames).toHaveLength(8);
    expect(catcherBounds).toBeNull();
    const yaws = frames.map((f) => yawOf(f.camera));
    yaws.forEach((yaw, i) => expect(yaw).toBeCloseTo((i * 45) % 360, 9));
    // One step past the last frame is the first again: the loop is seamless.
    expect((yaws.at(-1)! + 45) % 360).toBeCloseTo(yaws[0]!, 9);
    // Fitted: one distance for every frame, from the bounding sphere, the camera's pitch kept.
    const distances = frames.map((f) => distance(f.camera));
    for (const d of distances) expect(d).toBeCloseTo(distances[0]!, 9);
    expect(distances[0]).toBeGreaterThan(fitRadius(sceneBounds(doc)!));
    const pitch = Math.atan2(2, 10);
    for (const f of frames) {
      const height = f.camera.position[1] - f.camera.target[1];
      expect(Math.asin(height / distance(f.camera))).toBeCloseTo(pitch, 9);
    }
  });

  it('orbits the camera itself with camera framing', async () => {
    const { frames } = await plan({ kind: 'turntable', format: 'gif', fps: 10, frames: 4, framing: 'camera' });
    expect(frames[0]?.camera.position).toEqual(CAMERA.position);
    const quarter = frames[1]!.camera.position;
    const expected = orbitDirection(90, (Math.atan2(2, 10) * 180) / Math.PI).map((v) => v * Math.hypot(2, 10));
    quarter.forEach((v, k) => expect(v).toBeCloseTo(expected[k]!, 9));
    for (const f of frames) expect(distance(f.camera)).toBeCloseTo(Math.hypot(2, 10), 9);
  });

  it('frames an animation with one camera and one catcher around the union of every pose', async () => {
    const options = checked({ kind: 'animation', format: 'apng', fps: 4, animation: 'slide' });
    const { frames, catcherBounds } = await planFrames(doc, options);
    // 2 s at 4 fps of a loop: frame 8 would be frame 0 again.
    expect(frames.map((f) => f.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75]);
    const camera = frames[0]!.camera;
    for (const f of frames) expect(f.camera).toBe(camera);
    // The cube slides from x 0 to x 3.5 over the planned frames: the union holds every pose.
    expect(catcherBounds?.min).toEqual([-1, -1, -1]);
    expect(catcherBounds?.max[0]).toBeCloseTo(4.5, 6);
    expect(camera.target[0]).toBeCloseTo(1.75, 6);
    for (const f of frames) {
      const b = sceneBounds(framePose(doc, options as CheckedAnimationOptions, f.time))!;
      for (let k = 0; k < 3; k++) {
        expect(b.min[k]).toBeGreaterThanOrEqual(catcherBounds!.min[k]! - 1e-6);
        expect(b.max[k]).toBeLessThanOrEqual(catcherBounds!.max[k]! + 1e-6);
      }
    }
    expect(distance(camera)).toBeGreaterThan(catcherBounds!.radius);
  });

  it('ends a hold clip on its last frame, as animationFrameTimes counts export frames', async () => {
    const options = checked({ kind: 'animation', format: 'apng', fps: 2, animation: 0, loop: 'hold' });
    const { frames } = await planFrames(doc, options);
    expect(frames.map((f) => f.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    const last = framePose(doc, options as CheckedAnimationOptions, frames.at(-1)!.time);
    expect(sceneBounds(last)!.center[0]).toBeCloseTo(4, 6);
  });

  it('keeps the given camera for an animation with camera framing, and the union catcher', async () => {
    const { frames, catcherBounds } = await plan({
      kind: 'animation',
      format: 'apng',
      fps: 2,
      animation: 0,
      framing: 'camera',
      seconds: 1,
    });
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.camera).toEqual(CAMERA);
    expect(catcherBounds?.max[0]).toBeCloseTo(2, 6);
  });

  it('yields while it measures the poses and stops on abort', async () => {
    const controller = new AbortController();
    const pending = plan({ kind: 'animation', format: 'apng', fps: 60, animation: 0 }, controller.signal);
    let settled = false;
    void pending.catch(() => undefined).finally(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
