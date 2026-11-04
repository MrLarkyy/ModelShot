export function rgbe(r: number, g: number, b: number): [number, number, number, number];
export function encodeRadianceHdr(
  image: { readonly width: number; readonly height: number; readonly rgb: ArrayLike<number> },
  options?: { readonly rle?: boolean; readonly headerLines?: readonly string[] },
): Uint8Array;
