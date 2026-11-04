export function pngChunk(type: string, data: readonly number[]): number[];
export function exifOrientationData(value: number): number[];
export function encodeFlatPng(
  width: number,
  height: number,
  colours: readonly (readonly [number, number, number])[],
  options?: { readonly exifOrientation?: number },
): Uint8Array;
