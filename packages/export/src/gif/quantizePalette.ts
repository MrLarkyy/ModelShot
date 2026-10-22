import type { RenderedImage } from '@modelshot/pathtracer';

/** Colours a GIF frame keeps: 255, index 255 is transparent. */
export const GIF_COLOURS = 255;
export const TRANSPARENT_INDEX = 255;
/** A pixel under this alpha is transparent in the GIF, at or above it opaque (GIF has no partial alpha). */
export const GIF_ALPHA_CUTOFF = 128;

export interface PalettedFrame {
  /** 256 RGB entries; entries past `colours` and the transparent one are black. */
  readonly palette: Uint8Array<ArrayBuffer>;
  /** One palette index per pixel, rows top to bottom. */
  readonly indices: Uint8Array<ArrayBuffer>;
  /** Opaque colours in the palette. */
  readonly colours: number;
  readonly transparent: boolean;
}

// The histogram's bins: 5 bits per channel, 32 768 bins.
const BIN_BITS = 5;
const BIN_SIDE = 1 << BIN_BITS;
const BINS = BIN_SIDE ** 3;
const binOf = (r: number, g: number, b: number): number =>
  ((r >> 3) << (2 * BIN_BITS)) | ((g >> 3) << BIN_BITS) | (b >> 3);
// Open addressing for the exact path: room for 256 colours at under half load.
const EXACT_SLOTS = 1024;

/** A box of bins: inclusive bin coordinates per channel, shrunk to the occupied bins. */
interface Box {
  readonly lo: [number, number, number];
  readonly hi: [number, number, number];
}

/**
 * Exact palette: every opaque colour its own entry, in order of first appearance, or `null` past 255 colours. Fills
 * `indices` as it goes.
 */
function exactPalette(data: Uint8ClampedArray, indices: Uint8Array, palette: Uint8Array): number | null {
  const keys = new Int32Array(EXACT_SLOTS).fill(-1);
  const slots = new Uint8Array(EXACT_SLOTS);
  let colours = 0;
  let lastKey = -1;
  let lastIndex = 0;
  for (let i = 0, p = 0; p < indices.length; i += 4, p++) {
    if ((data[i + 3] as number) < GIF_ALPHA_CUTOFF) {
      indices[p] = TRANSPARENT_INDEX;
      continue;
    }
    const key = ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    if (key !== lastKey) {
      let slot = Math.imul(key, 0x9e3779b1) >>> 22;
      while (keys[slot] !== -1 && keys[slot] !== key) slot = (slot + 1) & (EXACT_SLOTS - 1);
      if (keys[slot] === -1) {
        if (colours === GIF_COLOURS) return null;
        keys[slot] = key;
        slots[slot] = colours;
        palette.set([key >> 16, (key >> 8) & 0xff, key & 0xff], colours * 3);
        colours++;
      }
      lastKey = key;
      lastIndex = slots[slot] as number;
    }
    indices[p] = lastIndex;
  }
  return colours;
}

function shrink(counts: Uint32Array, lo: number[], hi: number[]): Box | null {
  const min = [BIN_SIDE, BIN_SIDE, BIN_SIDE];
  const max = [-1, -1, -1];
  for (let r = lo[0] as number; r <= (hi[0] as number); r++) {
    for (let g = lo[1] as number; g <= (hi[1] as number); g++) {
      const row = (r << (2 * BIN_BITS)) | (g << BIN_BITS);
      for (let b = lo[2] as number; b <= (hi[2] as number); b++) {
        if (counts[row | b] === 0) continue;
        const at = [r, g, b];
        for (let c = 0; c < 3; c++) {
          if ((at[c] as number) < (min[c] as number)) min[c] = at[c] as number;
          if ((at[c] as number) > (max[c] as number)) max[c] = at[c] as number;
        }
      }
    }
  }
  if ((max[0] as number) < 0) return null;
  return { lo: min as [number, number, number], hi: max as [number, number, number] };
}

function forEachBin(box: Box, visit: (bin: number, r: number, g: number, b: number) => void): void {
  for (let r = box.lo[0]; r <= box.hi[0]; r++) {
    for (let g = box.lo[1]; g <= box.hi[1]; g++) {
      for (let b = box.lo[2]; b <= box.hi[2]; b++) visit((r << (2 * BIN_BITS)) | (g << BIN_BITS) | b, r, g, b);
    }
  }
}

/** Splits the boxes by median cut over the histogram until 255 boxes or none holds more than one bin. */
function splitBoxes(counts: Uint32Array, boxes: Box[]): void {
  const along = new Float64Array(BIN_SIDE);
  while (boxes.length < GIF_COLOURS) {
    let pick = -1;
    let channel = 0;
    let range = 0;
    boxes.forEach((box, i) => {
      for (let c = 0; c < 3; c++) {
        const extent = (box.hi[c] as number) - (box.lo[c] as number);
        if (extent > range) {
          pick = i;
          channel = c;
          range = extent;
        }
      }
    });
    if (pick < 0) return;
    const box = boxes[pick] as Box;
    along.fill(0);
    let total = 0;
    forEachBin(box, (bin, r, g, b) => {
      const n = counts[bin] as number;
      const v = channel === 0 ? r : channel === 1 ? g : b;
      along[v] = (along[v] as number) + n;
      total += n;
    });
    // The pixel-weighted median along the channel, kept inside the box so both halves hold a bin.
    const lo = box.lo[channel] as number;
    const hi = box.hi[channel] as number;
    let cut = lo;
    let acc = 0;
    for (let v = lo; v < hi; v++) {
      acc += along[v] as number;
      cut = v;
      if (acc * 2 >= total) break;
    }
    const leftHi = [...box.hi];
    leftHi[channel] = cut;
    const rightLo = [...box.lo];
    rightLo[channel] = cut + 1;
    const halves = [shrink(counts, box.lo, leftHi), shrink(counts, rightLo, box.hi)].filter((h): h is Box => !!h);
    boxes.splice(pick, 1, ...halves);
  }
}

/**
 * A palette of at most 255 colours over the opaque pixels, deterministic: a frame of 255 colours or fewer keeps every
 * one exactly (flat pixel art stays lossless); else median cut over a histogram of 5-bit bins per channel (cost per
 * pixel O(1), the cuts over 32 768 bins, so a 4096 × 4096 frame takes a fraction of a second): the box with the widest
 * channel range splits along it (ties: the first box, then r, g, b) at the pixel-weighted median, until 255 boxes or
 * none can split, and every pixel takes the mean of the pixels in its box. No dithering: a colour maps to one index,
 * so flat texels stay flat. Alpha under `GIF_ALPHA_CUTOFF` takes the transparent index.
 */
export function quantizePalette(image: RenderedImage): PalettedFrame {
  const { data } = image;
  const pixels = image.width * image.height;
  const indices = new Uint8Array(pixels);
  const palette = new Uint8Array(256 * 3);
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] as number) < GIF_ALPHA_CUTOFF) {
      transparent = true;
      break;
    }
  }
  const exact = exactPalette(data, indices, palette);
  if (exact !== null) return { palette, indices, colours: exact, transparent };
  // The exact pass gave up at its 256th colour: none of its entries may outlive it past the histogram's colours.
  palette.fill(0);
  const counts = new Uint32Array(BINS);
  const sums = new Float64Array(BINS * 3);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] as number) < GIF_ALPHA_CUTOFF) continue;
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const bin = binOf(r, g, b);
    counts[bin] = (counts[bin] as number) + 1;
    sums[bin * 3] = (sums[bin * 3] as number) + r;
    sums[bin * 3 + 1] = (sums[bin * 3 + 1] as number) + g;
    sums[bin * 3 + 2] = (sums[bin * 3 + 2] as number) + b;
  }
  const first = shrink(counts, [0, 0, 0], [BIN_SIDE - 1, BIN_SIDE - 1, BIN_SIDE - 1]);
  const boxes = first ? [first] : [];
  splitBoxes(counts, boxes);
  const binIndex = new Uint8Array(BINS);
  boxes.forEach((box, index) => {
    const mean = [0, 0, 0];
    let total = 0;
    forEachBin(box, (bin) => {
      const n = counts[bin] as number;
      if (n === 0) return;
      for (let c = 0; c < 3; c++) mean[c] = (mean[c] as number) + (sums[bin * 3 + c] as number);
      total += n;
      binIndex[bin] = index;
    });
    for (let c = 0; c < 3; c++) palette[index * 3 + c] = Math.round((mean[c] as number) / total);
  });
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    indices[p] =
      (data[i + 3] as number) < GIF_ALPHA_CUTOFF
        ? TRANSPARENT_INDEX
        : (binIndex[binOf(data[i] as number, data[i + 1] as number, data[i + 2] as number)] as number);
  }
  return { palette, indices, colours: boxes.length, transparent };
}
