import type { SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { Projector } from '../src/viewport/Projector';

const perspective: SceneCamera = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 90 },
  near: 0.1,
  far: 100,
};

describe('Projector', () => {
  it('puts the target at the centre and offsets as the camera sees them', () => {
    const p = new Projector(perspective, 200, 100);
    const centre = p.project([0, 0, 0]);
    expect(centre?.x).toBeCloseTo(100);
    expect(centre?.y).toBeCloseTo(50);
    // At distance 10 with a 90 degree field the visible half height is 10: 5 up is a quarter of the height up.
    expect(p.project([0, 5, 0])?.y).toBeCloseTo(25);
    // The half width is 20 at aspect 2: 10 to the right is a quarter of the width right of the centre.
    expect(p.project([10, 0, 0])?.x).toBeCloseTo(150);
  });

  it('returns null behind the camera', () => {
    expect(new Projector(perspective, 200, 100).project([0, 0, 20])).toBeNull();
  });

  it('projects orthographically with the visible height', () => {
    const ortho: SceneCamera = { ...perspective, projection: { kind: 'orthographic', height: 10 } };
    const p = new Projector(ortho, 100, 100);
    expect(p.project([0, 2.5, 0])?.y).toBeCloseTo(25);
    expect(p.project([0, 0, 30])).toBeNull();
  });

  it('says which way a direction faces', () => {
    const p = new Projector(perspective, 100, 100);
    expect(p.depthSign([0, 0, 1])).toBe(1);
    expect(p.depthSign([0, 0, -1])).toBe(-1);
  });
});
