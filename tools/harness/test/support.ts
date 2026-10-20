import { PNG } from 'pngjs';

export type Rgba = [number, number, number, number];

export function makePng(width: number, height: number, paint: (x: number, y: number) => Rgba): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      png.data.set(paint(x, y), (y * width + x) * 4);
    }
  }
  return PNG.sync.write(png);
}

export const gradientPaint = (x: number, y: number): Rgba => [x * 4, y * 4, (x + y) * 2, 255];
