import type { SceneCamera } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { GIZMO_SCREEN_PX, gizmoHandles, hitHandle, moveDelta, rotateDelta } from '../src/viewport/gizmoDrag';
import { gizmoFrame } from '../src/viewport/gizmoFrame';
import { Projector } from '../src/viewport/Projector';
import { boxMesh, doc, node } from './editorDocs';

const camera: SceneCamera = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 60 },
  near: 0.1,
  far: 100,
};
const d = doc([node(-1, { meshes: [0] })], [boxMesh(0)]);
const projector = new Projector(camera, 400, 400);
const frame = gizmoFrame(d, 0, 'move')!;

describe('gizmo', () => {
  it('has a frame at the pivot with the parent-space axes', () => {
    expect(frame.origin).toEqual([0, 0, 0]);
    expect(frame.axes[0]).toEqual([1, 0, 0]);
    expect(gizmoFrame(d, 5, 'move')).toBeNull();
  });

  it('draws a handle per axis about as long as the screen size', () => {
    const handles = gizmoHandles(projector, frame, 'move');
    const x = handles.find((h) => h.axis === 0)!;
    const [a, b] = x.polyline;
    expect(Math.hypot(b!.x - a!.x, b!.y - a!.y)).toBeCloseTo(GIZMO_SCREEN_PX, 0);
    expect(gizmoHandles(projector, frame, 'rotate')[0]?.polyline.length).toBeGreaterThan(8);
  });

  it('hits the nearest handle within the tolerance only', () => {
    const handles = gizmoHandles(projector, frame, 'move');
    expect(hitHandle(handles, { x: 200 + 40, y: 200 + 2 }, 6)?.axis).toBe(0);
    expect(hitHandle(handles, { x: 40, y: 40 }, 6)).toBeNull();
  });

  it('moves along the axis as it appears on screen', () => {
    const a = projector.project([0, 0, 0])!;
    const b = projector.project([1, 0, 0])!;
    const unit = b.x - a.x;
    expect(moveDelta(projector, frame, 0, { x: 200, y: 200 }, { x: 200 + unit * 3, y: 200 })).toBeCloseTo(3);
    // A drag across the axis moves nothing.
    expect(moveDelta(projector, frame, 0, { x: 200, y: 200 }, { x: 200, y: 260 })).toBeCloseTo(0);
  });

  it('rotates by the angle swept about the pivot, signed by the facing of the axis', () => {
    const rot = gizmoFrame(d, 0, 'rotate')!;
    // z points at the viewer: a counter-clockwise sweep on screen is a positive turn.
    expect(rotateDelta(projector, rot, 2, { x: 300, y: 200 }, { x: 200, y: 100 })).toBeCloseTo(90);
    expect(rotateDelta(projector, rot, 2, { x: 300, y: 200 }, { x: 200, y: 300 })).toBeCloseTo(-90);
  });
});
