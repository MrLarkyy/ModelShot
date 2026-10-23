import type { OrbitController } from '@modelshot/renderer-rt';

export type CameraPresetId = 'front' | 'side' | 'three-quarter' | 'isometric';

export interface CameraPreset {
  readonly id: CameraPresetId;
  readonly label: string;
}

/** The angles the goldens and look tuning use for the front view (yaw 210 pitch 20 is the three-quarter view). */
export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'three-quarter', label: 'Three-quarter' },
  { id: 'isometric', label: 'Isometric' },
];

const ANGLES = {
  front: [180, 0],
  side: [270, 0],
  'three-quarter': [210, 20],
} as const;

export function applyCameraPreset(orbit: OrbitController, id: CameraPresetId): void {
  if (id === 'isometric') {
    orbit.isometric();
    return;
  }
  const [yaw, pitch] = ANGLES[id];
  orbit.setAngles(yaw, pitch);
  orbit.frame();
}
