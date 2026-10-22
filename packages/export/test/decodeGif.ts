/** A test-side GIF89a reader, independent of the encoder: the textbook LZW decoder and the block structure. */

export interface DecodedGifFrame {
  /** RGBA, alpha 0 at the transparent index. */
  readonly rgba: Uint8Array;
  readonly indices: Uint8Array;
  readonly delayCs: number;
  readonly disposal: number;
  readonly transparentIndex: number | null;
}

export interface DecodedGif {
  readonly width: number;
  readonly height: number;
  /** NETSCAPE2.0 loop count, or null without one. */
  readonly loops: number | null;
  readonly frames: readonly DecodedGifFrame[];
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixels: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let table: number[][] = [];
  const reset = (): void => {
    table = Array.from({ length: end + 1 }, (_, i) => [i]);
  };
  reset();
  let codeSize = minCodeSize + 1;
  let bit = 0;
  const read = (): number => {
    let code = 0;
    for (let i = 0; i < codeSize; i++, bit++) {
      const byte = data[bit >> 3] ?? 0;
      code |= ((byte >> (bit & 7)) & 1) << i;
    }
    return code;
  };
  const out: number[] = [];
  let prev = -1;
  for (;;) {
    if (bit >= data.length * 8 + 16) throw new Error('LZW data ended without the end code');
    const code = read();
    if (code === clear) {
      reset();
      codeSize = minCodeSize + 1;
      prev = -1;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    const previous = prev >= 0 ? table[prev] : undefined;
    if (code < table.length) entry = table[code] as number[];
    else if (code === table.length && previous) entry = [...previous, previous[0] as number];
    else throw new Error(`LZW code ${code} past the table (${table.length})`);
    out.push(...entry);
    if (previous && table.length < 4096) {
      table.push([...previous, entry[0] as number]);
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  if (out.length !== pixels) throw new Error(`LZW gave ${out.length} indices for ${pixels} pixels`);
  return new Uint8Array(out);
}

export function decodeGif(file: Uint8Array): DecodedGif {
  const ascii = (at: number, n: number): string => String.fromCharCode(...file.subarray(at, at + n));
  const u16 = (at: number): number => (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
  if (ascii(0, 6) !== 'GIF89a') throw new Error('not GIF89a');
  const width = u16(6);
  const height = u16(8);
  if ((file[10] ?? 0) & 0x80) throw new Error('unexpected global colour table');
  let at = 13;
  let loops: number | null = null;
  let control = { delayCs: 0, disposal: 0, transparentIndex: null as number | null };
  const frames: DecodedGifFrame[] = [];
  const subBlocks = (): Uint8Array => {
    const parts: number[] = [];
    for (let size = file[at++] ?? 0; size > 0; size = file[at++] ?? 0) {
      parts.push(...file.subarray(at, at + size));
      at += size;
    }
    return new Uint8Array(parts);
  };
  for (;;) {
    const introducer = file[at++];
    if (introducer === 0x3b) break;
    if (introducer === 0x21) {
      const label = file[at++];
      if (label === 0xff) {
        const size = file[at++] ?? 0;
        const name = ascii(at, size);
        at += size;
        const data = subBlocks();
        if (name === 'NETSCAPE2.0') loops = (data[1] ?? 0) | ((data[2] ?? 0) << 8);
      } else if (label === 0xf9) {
        const data = subBlocks();
        const packed = data[0] ?? 0;
        control = {
          disposal: (packed >> 2) & 7,
          delayCs: (data[1] ?? 0) | ((data[2] ?? 0) << 8),
          transparentIndex: packed & 1 ? (data[3] ?? 0) : null,
        };
      } else {
        subBlocks();
      }
      continue;
    }
    if (introducer !== 0x2c) throw new Error(`unexpected block 0x${(introducer ?? 0).toString(16)}`);
    const w = u16(at + 4);
    const h = u16(at + 6);
    const packed = file[at + 8] ?? 0;
    at += 9;
    if (!(packed & 0x80)) throw new Error('frame without a local colour table');
    const entries = 2 << (packed & 7);
    const palette = file.subarray(at, at + entries * 3);
    at += entries * 3;
    const minCodeSize = file[at++] ?? 0;
    const indices = lzwDecode(subBlocks(), minCodeSize, w * h);
    const rgba = new Uint8Array(w * h * 4);
    indices.forEach((index, i) => {
      rgba.set(palette.subarray(index * 3, index * 3 + 3), i * 4);
      rgba[i * 4 + 3] = index === control.transparentIndex ? 0 : 255;
    });
    frames.push({ rgba, indices, ...control });
  }
  return { width, height, loops, frames };
}
