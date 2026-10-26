import type { Rgb } from '@modelshot/looks';

/** `#rrggbb` (as `parseEmbedParams` normalises `background`) as display-encoded sRGB channels in 0..1. */
export function hexDisplayColor(hex: string): Rgb {
  const channel = (i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return [channel(0), channel(1), channel(2)];
}
