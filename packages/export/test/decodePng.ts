/** A test-side PNG and APNG reader, independent of the encoder: bitwise CRC, the platform's inflate, all 5 filters. */

export interface DecodedPngFrame {
  readonly rgba: Uint8Array;
  /** fcTL delay as numerator / denominator seconds; 0 / 0 for a plain PNG. */
  readonly delayNum: number;
  readonly delayDen: number;
  readonly dispose: number;
  readonly blend: number;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** acTL's frame count and plays, or null for a plain PNG. */
  readonly animation: { readonly frames: number; readonly plays: number } | null;
  readonly frames: readonly DecodedPngFrame[];
  readonly chunkTypes: readonly string[];
}

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function unfilter(raw: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 4;
  const out = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (row + 1)];
    for (let x = 0; x < row; x++) {
      const v = raw[y * (row + 1) + 1 + x] ?? 0;
      const a = x >= 4 ? (out[y * row + x - 4] ?? 0) : 0;
      const b = y > 0 ? (out[(y - 1) * row + x] ?? 0) : 0;
      const c = x >= 4 && y > 0 ? (out[(y - 1) * row + x - 4] ?? 0) : 0;
      let predictor = 0;
      if (type === 1) predictor = a;
      else if (type === 2) predictor = b;
      else if (type === 3) predictor = (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (type !== 0) throw new Error(`filter type ${type}`);
      out[y * row + x] = (v + predictor) & 0xff;
    }
  }
  return out;
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export async function decodePng(file: Uint8Array): Promise<DecodedPng> {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => file[i] === b)) throw new Error('no PNG signature');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let height = 0;
  let animation: DecodedPng['animation'] = null;
  const chunkTypes: string[] = [];
  const pending: { control: Omit<DecodedPngFrame, 'rgba'>; data: Uint8Array[] }[] = [];
  const plain: Uint8Array[] = [];
  let sequence = 0;
  for (let at = 8; at < file.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const data = file.subarray(at + 8, at + 8 + length);
    if (crc(file.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length)) throw new Error(`${type} CRC`);
    chunkTypes.push(type);
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (type === 'IHDR') {
      width = d.getUint32(0);
      height = d.getUint32(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('not 8-bit RGBA');
    } else if (type === 'acTL') {
      animation = { frames: d.getUint32(0), plays: d.getUint32(4) };
    } else if (type === 'fcTL') {
      if (d.getUint32(0) !== sequence++) throw new Error('fcTL out of sequence');
      pending.push({
        control: {
          delayNum: d.getUint16(20),
          delayDen: d.getUint16(22),
          dispose: data[24] ?? -1,
          blend: data[25] ?? -1,
        },
        data: [],
      });
    } else if (type === 'IDAT') {
      if (animation) pending.at(-1)?.data.push(data);
      else plain.push(data);
    } else if (type === 'fdAT') {
      if (d.getUint32(0) !== sequence++) throw new Error('fdAT out of sequence');
      pending.at(-1)?.data.push(data.subarray(4));
    }
    at += 12 + length;
  }
  if (chunkTypes.at(-1) !== 'IEND') throw new Error('no IEND last');
  const frames: DecodedPngFrame[] = [];
  if (!animation) {
    const rgba = unfilter(await inflate(concat(plain)), width, height);
    frames.push({ rgba, delayNum: 0, delayDen: 0, dispose: 0, blend: 0 });
  }
  for (const frame of pending) {
    frames.push({ ...frame.control, rgba: unfilter(await inflate(concat(frame.data)), width, height) });
  }
  return { width, height, animation, frames, chunkTypes };
}
