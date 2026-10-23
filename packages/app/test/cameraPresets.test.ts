import { OrbitController } from '@modelshot/renderer-rt';
import { ISOMETRIC_PITCH_DEG, ISOMETRIC_YAW_DEG } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS, applyCameraPreset } from '../src/panels/cameraPresets';

const controller = (): OrbitController => new OrbitController({ damping: false });

describe('camera presets', () => {
  it('offers front, side, three-quarter and isometric', () => {
    expect(CAMERA_PRESETS.map((preset) => preset.id)).toEqual(['front', 'side', 'three-quarter', 'isometric']);
  });

  it.each([
    ['front', 180, 0],
    ['side', 270, 0],
    ['three-quarter', 210, 20],
  ] as const)('%s sets yaw %d and pitch %d', (id, yaw, pitch) => {
    const orbit = controller();
    orbit.rotate(33, 11);
    applyCameraPreset(orbit, id);
    expect(orbit.angles).toEqual({ yawDeg: yaw, pitchDeg: pitch });
    expect(orbit.projection).toBe('perspective');
  });

  it('isometric is orthographic at the isometric angles', () => {
    const orbit = controller();
    applyCameraPreset(orbit, 'isometric');
    expect(orbit.projection).toBe('orthographic');
    expect(orbit.angles.yawDeg).toBeCloseTo(ISOMETRIC_YAW_DEG, 9);
    expect(orbit.angles.pitchDeg).toBeCloseTo(ISOMETRIC_PITCH_DEG, 9);
  });
});
