import type { OrbitController } from '@modelshot/renderer-rt';
import { ISOMETRIC_PITCH_DEG, ISOMETRIC_YAW_DEG } from '@modelshot/scene';

export type CameraPresetId = 'front' | 'side' | 'three-quarter' | 'isometric';

export interface CameraPreset {
  readonly id: CameraPresetId;
  readonly label: string;
  /** The label of a narrow view bar. */
  readonly short: string;
}

/** The angles the goldens and look tuning use for the front view (yaw 210 pitch 20 is the three-quarter view). */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { id: 'front', label: 'Front', short: 'F' },
  { id: 'side', label: 'Side', short: 'S' },
  { id: 'three-quarter', label: 'Three-quarter', short: '¾' },
  { id: 'isometric', label: 'Isometric', short: 'Iso' },
];

const ANGLES = {
  front: [180, 0],
  side: [270, 0],
  'three-quarter': [210, 20],
} as const;

/** How far from a preset's angles the view still counts as that preset (degrees). */
const PRESET_TOLERANCE_DEG = 0.5;

const near = (a: number, b: number): boolean => Math.abs(((((a - b) % 360) + 540) % 360) - 180) <= PRESET_TOLERANCE_DEG;

/** The preset the camera stands at (projection and angles), or null after any orbit away from one. */
export function activeCameraPreset(orbit: OrbitController): CameraPresetId | null {
  const { yawDeg, pitchDeg } = orbit.angles;
  if (orbit.projection === 'orthographic') {
    return near(yawDeg, ISOMETRIC_YAW_DEG) && Math.abs(pitchDeg - ISOMETRIC_PITCH_DEG) <= PRESET_TOLERANCE_DEG
      ? 'isometric'
      : null;
  }
  for (const [id, [yaw, pitch]] of Object.entries(ANGLES) as [keyof typeof ANGLES, readonly [number, number]][]) {
    if (near(yawDeg, yaw) && Math.abs(pitchDeg - pitch) <= PRESET_TOLERANCE_DEG) return id;
  }
  return null;
}

export function applyCameraPreset(orbit: OrbitController, id: CameraPresetId): void {
  if (id === 'isometric') {
    orbit.isometric();
    return;
  }
  const [yaw, pitch] = ANGLES[id];
  orbit.setAngles(yaw, pitch);
  orbit.frame();
}
