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

interface Box {
  /** Range [start, end) of the sorted unique colours. */
  readonly start: number;
  readonly end: number;
  /** The channel of the widest range and that range, measured once when the box is made. */
  readonly channel: number;
  readonly range: number;
}

const channel = (colour: number, c: number): number => (colour >>> (16 - 8 * c)) & 0xff;

function makeBox(colours: Uint32Array, start: number, end: number): Box {
  return { start, end, ...extent(colours, start, end) };
}

function extent(colours: Uint32Array, start: number, end: number): { channel: number; range: number } {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (let i = start; i < end; i++) {
    for (let c = 0; c < 3; c++) {
      const v = channel(colours[i] as number, c);
      if (v < (min[c] as number)) min[c] = v;
      if (v > (max[c] as number)) max[c] = v;
    }
  }
  let best = 0;
  for (let c = 1; c < 3; c++)
    if ((max[c] as number) - (min[c] as number) > (max[best] as number) - (min[best] as number)) best = c;
  return { channel: best, range: (max[best] as number) - (min[best] as number) };
}

/**
 * A palette of at most 255 colours by median cut over the opaque pixels, deterministic: an image of 255 colours or
 * fewer keeps every one exactly (flat pixel art stays lossless); else the box with the widest channel range splits
 * along that channel (ties: the first box, then r, g, b) at the pixel-weighted median, until 255 boxes or none can
 * split, and every pixel takes its box's weighted mean. No dithering: each colour maps to one index, so pixel art
 * keeps its flat texels. Alpha under `GIF_ALPHA_CUTOFF` takes the transparent index.
 */
export function quantizePalette(image: RenderedImage): PalettedFrame {
  const { data } = image;
  const pixels = image.width * image.height;
  const keys = new Uint32Array(pixels);
  let opaque = 0;
  for (let i = 0; i < pixels; i++) {
    if ((data[i * 4 + 3] as number) < GIF_ALPHA_CUTOFF) continue;
    keys[opaque++] = ((data[i * 4] as number) << 16) | ((data[i * 4 + 1] as number) << 8) | (data[i * 4 + 2] as number);
  }
  const sorted = keys.subarray(0, opaque).sort();
  // Unique colours with their pixel counts.
  const unique = new Uint32Array(opaque);
  const counts = new Uint32Array(opaque);
  let n = 0;
  for (let i = 0; i < opaque; i++) {
    const key = sorted[i] as number;
    if (n > 0 && unique[n - 1] === key) {
      counts[n - 1] = (counts[n - 1] as number) + 1;
    } else {
      unique[n] = key;
      counts[n] = 1;
      n++;
    }
  }
  const colours = unique.subarray(0, n);
  const weights = counts.subarray(0, n);
  let boxes: Box[];
  if (n <= GIF_COLOURS) {
    boxes = Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, channel: 0, range: 0 }));
  } else {
    boxes = [makeBox(colours, 0, n)];
    splitBoxes(colours, weights, boxes);
  }
  const palette = new Uint8Array(256 * 3);
  // Colour key -> palette index, from the box each unique colour fell in.
  const indexOf = new Map<number, number>();
  boxes.forEach((box, index) => {
    const sums = [0, 0, 0];
    let total = 0;
    for (let i = box.start; i < box.end; i++) {
      const w = weights[i] as number;
      for (let c = 0; c < 3; c++) sums[c] = (sums[c] as number) + channel(colours[i] as number, c) * w;
      total += w;
      indexOf.set(colours[i] as number, index);
    }
    for (let c = 0; c < 3; c++) palette[index * 3 + c] = Math.round((sums[c] as number) / total);
  });
  const indices = new Uint8Array(pixels);
  let transparent = false;
  for (let i = 0; i < pixels; i++) {
    if ((data[i * 4 + 3] as number) < GIF_ALPHA_CUTOFF) {
      indices[i] = TRANSPARENT_INDEX;
      transparent = true;
      continue;
    }
    const key = ((data[i * 4] as number) << 16) | ((data[i * 4 + 1] as number) << 8) | (data[i * 4 + 2] as number);
    indices[i] = indexOf.get(key) as number;
  }
  return { palette, indices, colours: boxes.length, transparent };
}

function splitBoxes(colours: Uint32Array, weights: Uint32Array, boxes: Box[]): void {
  // Sorting a box along a channel reorders its colours together with their weights.
  const order = new Uint32Array(colours.length);
  while (boxes.length < GIF_COLOURS) {
    let pick = -1;
    let pickChannel = 0;
    let pickRange = 0;
    boxes.forEach((box, i) => {
      if (box.end - box.start < 2 || box.range <= pickRange) return;
      pick = i;
      pickChannel = box.channel;
      pickRange = box.range;
    });
    if (pick < 0) return;
    const box = boxes[pick] as Box;
    const length = box.end - box.start;
    for (let i = 0; i < length; i++) order[i] = box.start + i;
    const span = order.subarray(0, length);
    // Ties on the channel keep the colour order (a stable, deterministic sort).
    const sortedSpan = Array.from(span).sort(
      (a, b) =>
        channel(colours[a] as number, pickChannel) - channel(colours[b] as number, pickChannel) ||
        (colours[a] as number) - (colours[b] as number),
    );
    const sortedColours = sortedSpan.map((i) => colours[i] as number);
    const sortedWeights = sortedSpan.map((i) => weights[i] as number);
    colours.set(sortedColours, box.start);
    weights.set(sortedWeights, box.start);
    let total = 0;
    for (const w of sortedWeights) total += w;
    // The weighted median, kept inside the box so both halves have a colour.
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < length - 1; i++) {
      acc += sortedWeights[i] as number;
      cut = i + 1;
      if (acc * 2 >= total) break;
    }
    boxes.splice(pick, 1, makeBox(colours, box.start, box.start + cut), makeBox(colours, box.start + cut, box.end));
  }
}
