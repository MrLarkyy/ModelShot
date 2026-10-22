// The export fixture's decoders: what a viewer of the exported file sees, read back in the page. PNG and APNG frames
// go through @modelshot/formats' own PNG reader (exact bytes, no canvas premultiplication); GIF and WebP through the
// browser's ImageDecoder; WebM and MP4 through a demux of our containers written here and the browser's VideoDecoder.
import { decodePngRgba } from '../../../../packages/formats/src/png/decodePngRgba';

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const be = (bytes: Uint8Array, at: number, n: number): number => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (bytes[at + i] ?? 0);
  return v;
};
const ascii = (bytes: Uint8Array, at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A chunk for the formats reader, which does not check CRCs: length, type, data, a zero CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/** Every frame of a PNG or APNG as exact RGBA: each APNG frame rebuilt as a still PNG around its fdAT data. */
export function decodePngFrames(file: Uint8Array): Uint8Array[] {
  const ihdr: Uint8Array[] = [];
  const frames: Uint8Array[][] = [];
  let animated = false;
  const plain: Uint8Array[] = [];
  for (let at = 8; at + 8 <= file.length;) {
    const length = be(file, at, 4);
    const type = ascii(file, at + 4);
    const data = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') ihdr.push(data);
    else if (type === 'acTL') animated = true;
    else if (type === 'fcTL') frames.push([]);
    else if (type === 'IDAT') (animated ? frames.at(-1) : plain)?.push(data);
    else if (type === 'fdAT') frames.at(-1)?.push(data.subarray(4));
    at += 12 + length;
  }
  const header = ihdr[0];
  if (!header) throw new Error('no IHDR');
  const stills = animated ? frames : [plain];
  return stills.map((idat, i) => {
    const png = concat([
      SIGNATURE,
      chunk('IHDR', header),
      chunk('IDAT', concat(idat)),
      chunk('IEND', new Uint8Array(0)),
    ]);
    const image = decodePngRgba(png, 1 << 24);
    if (!image) throw new Error(`frame ${i} does not decode`);
    return image.rgba;
  });
}

/** RGBA of a decoded frame, straight alpha where the frame's own layout allows it. */
async function frameRgba(frame: VideoFrame): Promise<Uint8Array> {
  const width = frame.displayWidth;
  const height = frame.displayHeight;
  const format = frame.format;
  if (format === 'RGBA' || format === 'RGBX' || format === 'BGRA' || format === 'BGRX') {
    const data = new Uint8Array(width * height * 4);
    await frame.copyTo(data);
    if (format.startsWith('BGR')) {
      for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2] ?? 0, data[i] ?? 0];
    }
    if (format.endsWith('X')) for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return data;
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D context');
  context.drawImage(frame, 0, 0);
  return new Uint8Array(context.getImageData(0, 0, width, height).data);
}

/** Every frame the browser's ImageDecoder reads from the file (GIF, WebP, APNG), as a viewer composites them. */
export async function decodeImageFrames(file: Uint8Array, type: string): Promise<Uint8Array[]> {
  // premultiplyAlpha is in the WebCodecs specification and Chromium, not yet in TypeScript's DOM types.
  const init: ImageDecoderInit & { premultiplyAlpha: 'none' } = {
    data: file,
    type,
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  };
  const decoder = new ImageDecoder(init);
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
    const frames: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      frames.push(await frameRgba(image));
      image.close();
    }
    return frames;
  } finally {
    decoder.close();
  }
}

interface Sample {
  readonly data: Uint8Array;
  readonly key: boolean;
  readonly timestamp: number;
}

const EBML_MASTERS = new Set([0x18538067, 0x1654ae6b, 0xae, 0x1f43b675]);

function ebml(bytes: Uint8Array, visit: (id: number, data: Uint8Array) => void): void {
  for (let at = 0; at < bytes.length;) {
    const idLength = Math.clz32(bytes[at] ?? 0) - 23;
    const id = be(bytes, at, idLength);
    at += idLength;
    const sizeLength = Math.clz32(bytes[at] ?? 0) - 23;
    const size = be(bytes, at, sizeLength) - (0x80 >> (sizeLength - 1)) * 256 ** (sizeLength - 1);
    at += sizeLength;
    const data = bytes.subarray(at, at + size);
    if (EBML_MASTERS.has(id)) ebml(data, visit);
    else visit(id, data);
    at += size;
  }
}

/** The blocks and codec of one of our WebM files. */
export function demuxWebm(file: Uint8Array): { codec: string; samples: Sample[] } {
  let codec = '';
  let clusterStart = 0;
  const samples: Sample[] = [];
  ebml(file, (id, data) => {
    if (id === 0x86) codec = new TextDecoder().decode(data);
    else if (id === 0xe7) clusterStart = be(data, 0, data.length);
    else if (id === 0xa3) {
      const time = clusterStart + new DataView(data.buffer, data.byteOffset).getInt16(1);
      samples.push({ data: data.subarray(4), key: ((data[3] ?? 0) & 0x80) !== 0, timestamp: time * 1000 });
    }
  });
  return { codec: codec === 'V_VP8' ? 'vp8' : 'vp09.00.10.08', samples };
}

function boxes(bytes: Uint8Array, visit: (type: string, body: Uint8Array) => void): void {
  for (let at = 0; at + 8 <= bytes.length;) {
    const size = be(bytes, at, 4);
    const type = ascii(bytes, at + 4);
    const body = bytes.subarray(at + 8, at + size);
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) boxes(body, visit);
    else visit(type, body);
    at += size;
  }
}

/** The samples, codec and avcC of one of our MP4 files, from its sample table. */
export function demuxMp4(file: Uint8Array, fps: number): { codec: string; description: Uint8Array; samples: Sample[] } {
  let sizes: number[] = [];
  let offsets: number[] = [];
  let keys = new Set<number>();
  let description: Uint8Array = new Uint8Array(0);
  boxes(file, (type, body) => {
    if (type === 'stsz') sizes = Array.from({ length: be(body, 8, 4) }, (_, i) => be(body, 12 + i * 4, 4));
    else if (type === 'stco') offsets = Array.from({ length: be(body, 4, 4) }, (_, i) => be(body, 8 + i * 4, 4));
    else if (type === 'stss') keys = new Set(Array.from({ length: be(body, 4, 4) }, (_, i) => be(body, 8 + i * 4, 4)));
    else if (type === 'stsd') description = body.subarray(8 + 8 + 78 + 8, 8 + be(body, 8, 4));
  });
  const hex = (v: number | undefined): string => (v ?? 0).toString(16).padStart(2, '0');
  const codec = `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`;
  const samples = sizes.map((size, i) => ({
    data: file.subarray(offsets[i] ?? 0, (offsets[i] ?? 0) + size),
    key: keys.has(i + 1),
    timestamp: Math.round((i * 1e6) / fps),
  }));
  return { codec, description, samples };
}

/** Every frame of a demuxed video through the browser's VideoDecoder. */
export async function decodeVideoFrames(samples: readonly Sample[], config: VideoDecoderConfig): Promise<Uint8Array[]> {
  const decoded: VideoFrame[] = [];
  const failures: Error[] = [];
  const decoder = new VideoDecoder({
    output: (frame) => decoded.push(frame),
    error: (error) => failures.push(error),
  });
  decoder.configure(config);
  for (const s of samples) {
    decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.timestamp, data: s.data }));
  }
  await decoder.flush();
  decoder.close();
  if (failures[0]) throw failures[0];
  const frames: Uint8Array[] = [];
  for (const frame of decoded) {
    frames.push(await frameRgba(frame));
    frame.close();
  }
  return frames;
}
