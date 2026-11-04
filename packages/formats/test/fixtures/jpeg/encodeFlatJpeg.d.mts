export function rgbToYcc(rgb: readonly [number, number, number]): [number, number, number];
export function yccToRgb(ycc: readonly [number, number, number]): [number, number, number];
export function encodeFlatJpeg(
  width: number,
  height: number,
  blocks: readonly (readonly [number, number, number])[],
  options?: { readonly exifOrientation?: number; readonly headerOnly?: boolean },
): Uint8Array;
