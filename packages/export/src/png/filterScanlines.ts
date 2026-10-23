import type { RenderedImage } from '@modelshot/pathtracer';

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The image's scanlines with a filter byte each: per row None or Paeth, whichever has the smaller sum of absolute
 * values as signed bytes (the PNG specification's heuristic); flat pixel art mostly takes Paeth's zeros.
 */
export function filterScanlines(image: RenderedImage): Uint8Array<ArrayBuffer> {
  const { width, height, data } = image;
  const row = width * 4;
  const out = new Uint8Array(height * (row + 1));
  const paethRow = new Uint8Array(row);
  for (let y = 0; y < height; y++) {
    const at = y * row;
    let noneCost = 0;
    let paethCost = 0;
    for (let x = 0; x < row; x++) {
      const value = data[at + x] as number;
      const left = x >= 4 ? (data[at + x - 4] as number) : 0;
      const up = y > 0 ? (data[at + x - row] as number) : 0;
      const upLeft = y > 0 && x >= 4 ? (data[at + x - row - 4] as number) : 0;
      const filtered = (value - paeth(left, up, upLeft)) & 0xff;
      paethRow[x] = filtered;
      noneCost += value < 128 ? value : 256 - value;
      paethCost += filtered < 128 ? filtered : 256 - filtered;
    }
    const target = y * (row + 1);
    if (paethCost < noneCost) {
      out[target] = 4;
      out.set(paethRow, target + 1);
    } else {
      out[target] = 0;
      out.set(data.subarray(at, at + row), target + 1);
    }
  }
  return out;
}
