import { OrbitController } from '@modelshot/renderer-rt';
import { ISOMETRIC_PITCH_DEG, ISOMETRIC_YAW_DEG } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { CAMERA_PRESETS, activeCameraPreset, applyCameraPreset } from '../src/panels/cameraPresets';

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

describe('activeCameraPreset', () => {
  it.each(['front', 'side', 'three-quarter', 'isometric'] as const)('finds %s after applying it', (id) => {
    const orbit = controller();
    applyCameraPreset(orbit, id);
    expect(activeCameraPreset(orbit)).toBe(id);
  });

  it('is none after an orbit away, in a projection the preset does not use, or at no preset angles', () => {
    const orbit = controller();
    applyCameraPreset(orbit, 'front');
    orbit.rotate(10, 0);
    expect(activeCameraPreset(orbit)).toBeNull();
    applyCameraPreset(orbit, 'front');
    orbit.setProjection('orthographic');
    expect(activeCameraPreset(orbit)).toBeNull();
    orbit.setAngles(100, 5);
    expect(activeCameraPreset(orbit)).toBeNull();
  });

  it('matches across the 0 and 360 degree seam', () => {
    const orbit = controller();
    orbit.setAngles(180.3, 0.2);
    expect(activeCameraPreset(orbit)).toBe('front');
  });
});
