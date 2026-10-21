import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { tokens } from '../src/tokens';

// The PNGs are rendered by scripts/renderPngs.mjs; pixels, not bytes, are pinned (the rasteriser may differ).
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'public');

function read(name: string): PNG {
  return PNG.sync.read(readFileSync(join(publicDir, name)));
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function pixel(png: PNG, x: number, y: number): [number, number, number, number] {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
}

function distance(png: PNG, x: number, y: number, hex: string): number {
  const [r, g, b, a] = pixel(png, x, y);
  const [er, eg, eb] = rgb(hex);
  return a < 250 ? 255 : Math.max(Math.abs(r - er), Math.abs(g - eg), Math.abs(b - eb));
}

const ICONS = [
  ['favicon-16.png', 16, false],
  ['favicon-32.png', 32, true],
  ['apple-touch-icon.png', 180, true],
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
] as const;

describe('PNG icons', () => {
  it.each(ICONS)('%s is %i px square', (name, size) => {
    const png = read(name);
    expect([png.width, png.height]).toEqual([size, size]);
  });

  it.each(ICONS)('%s has a shot blue tile at its left edge', (name, size) => {
    expect(distance(read(name), Math.floor(size * 0.08), size / 2, tokens.color.shotBlue)).toBeLessThanOrEqual(6);
  });

  it.each(ICONS)('%s shows the flash dot: %s', (name, size, dot) => {
    const d = distance(read(name), (104 / 132) * size, (28 / 132) * size, tokens.color.flash);
    if (dot) expect(d).toBeLessThanOrEqual(12);
    else expect(d).toBeGreaterThan(60);
  });

  it('keeps transparent corners on the rounded icons and fills them on the apple touch icon', () => {
    expect(pixel(read('icon-512.png'), 0, 0)[3]).toBe(0);
    expect(distance(read('apple-touch-icon.png'), 0, 0, tokens.color.shotBlue)).toBeLessThanOrEqual(6);
  });
});

describe('social preview', () => {
  const png = read('social-preview.png');

  it('is 1200 x 630', () => {
    expect([png.width, png.height]).toEqual([1200, 630]);
  });

  it('has the cloud ground on the left and the shot blue tile on the right', () => {
    expect(distance(png, 20, 315, tokens.color.cloud)).toBeLessThanOrEqual(6);
    expect(distance(png, 1130, 315, tokens.color.shotBlue)).toBeLessThanOrEqual(6);
  });

  it('carries the flash dot in the tile corner', () => {
    expect(distance(png, 1094, 106, tokens.color.flash)).toBeLessThanOrEqual(6);
  });

  it('has ink headline text', () => {
    let ink = 0;
    for (let x = 56; x < 600; x++) if (distance(png, x, 240, tokens.color.ink) <= 12) ink++;
    expect(ink).toBeGreaterThan(100);
  });
});
