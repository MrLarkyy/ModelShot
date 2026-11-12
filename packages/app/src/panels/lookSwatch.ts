import type { LookPreset } from '@modelshot/looks';
import { lightHex, srgbHex } from '../inspector/lightValues';

/** A look as a CSS background, from its data: the backdrop gradient, a glow in the key's tint, a rim line when it has one. No rendering. */
export function lookSwatch(look: LookPreset): string {
  const { backdrop, lights } = look;
  const layers: string[] = [];
  const rim = lightHex(lights.rim.color);
  if (rim) layers.push(`linear-gradient(90deg, ${rim}99 0%, transparent 22%)`);
  const key = lightHex(lights.key.color);
  if (key) layers.push(`radial-gradient(circle at 68% 30%, ${key}CC 0%, transparent 58%)`);
  layers.push(`linear-gradient(180deg, ${srgbHex(backdrop.top)}, ${srgbHex(backdrop.bottom)})`);
  return layers.join(', ');
}
