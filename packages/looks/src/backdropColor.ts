import type { Rgb } from './agxToneMap';
import type { LookPreset } from './LookPreset';

/**
 * The scene-linear backdrop of `glsl/backdrop.glsl` at `yNorm`, the height in the frame from 0 (bottom edge) to 1
 * (top edge): `gl_FragCoord.y / frameHeight`, so the pixel row r counted from the top of an H-row image sits at
 * `(H − r − 0.5) / H`. Equal top and bottom give exactly that colour.
 */
export function backdropColor(look: Pick<LookPreset, 'backdrop'>, yNorm: number): Rgb {
  const { top, bottom } = look.backdrop;
  return [
    bottom[0] + (top[0] - bottom[0]) * yNorm,
    bottom[1] + (top[1] - bottom[1]) * yNorm,
    bottom[2] + (top[2] - bottom[2]) * yNorm,
  ];
}
