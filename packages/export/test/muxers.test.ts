import { describe, expect, it } from 'vitest';
import { frameDurations } from '../src/frameDurations';
import type { EncodedFrame } from '../src/video/EncodedFrame';
import { muxMp4 } from '../src/video/muxMp4';
import { muxWebm } from '../src/video/muxWebm';
import { videoCodecCandidates } from '../src/video/videoCodecs';
import { muxAnimatedWebp } from '../src/webp/muxAnimatedWebp';
import { readWebpFrame } from '../src/webp/readWebpFrame';

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const ascii = (bytes: Uint8Array, at: number, n = 4): string => String.fromCharCode(...bytes.subarray(at, at + n));
const le = (bytes: Uint8Array, at: number, n: number): number => {
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + (bytes[at + i] ?? 0);
  return v;
};
const be = (bytes: Uint8Array, at: number, n: number): number => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (bytes[at + i] ?? 0);
  return v;
};

function riffChunk(type: string, payload: number[]): number[] {
  const size = payload.length;
  return [
    ...new TextEncoder().encode(type),
    size & 0xff,
    (size >> 8) & 0xff,
    0,
    0,
    ...payload,
    ...(size & 1 ? [0] : []),
  ];
}

function riff(chunks: number[]): Uint8Array {
  const size = chunks.length + 4;
  return new Uint8Array([
    ...new TextEncoder().encode('RIFF'),
    size & 0xff,
    (size >> 8) & 0xff,
    0,
    0,
    ...new TextEncoder().encode('WEBP'),
    ...chunks,
  ]);
}

/** A lossless still: VP8L with the size in its header (the bitstream itself is not decoded here). */
function losslessStill(width: number, height: number, filler: number): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | (1 << 28);
  return riff(
    riffChunk('VP8L', [
      0x2f,
      bits & 0xff,
      (bits >> 8) & 0xff,
      (bits >> 16) & 0xff,
      (bits >>> 24) & 0xff,
      filler,
      filler,
      filler,
    ]),
  );
}

/** A lossy still with alpha: VP8X, ALPH and VP8 (frame tag, start code, size). */
function lossyStill(width: number, height: number): Uint8Array {
  const vp8x = riffChunk('VP8X', [0x10, 0, 0, 0, width - 1, 0, 0, height - 1, 0, 0]);
  const alph = riffChunk('ALPH', [0, 1, 2]);
  const vp8 = riffChunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, 7]);
  return riff([...vp8x, ...alph, ...vp8]);
}

describe('animated WebP muxing', () => {
  it('reads the image chunks of lossless and lossy stills', () => {
    const lossless = readWebpFrame(losslessStill(20, 10, 9));
    expect([lossless.width, lossless.height, lossless.alpha]).toEqual([20, 10, true]);
    expect(ascii(lossless.chunks, 0)).toBe('VP8L');
    const lossy = readWebpFrame(lossyStill(20, 10));
    expect([lossy.width, lossy.height, lossy.alpha]).toEqual([20, 10, true]);
    expect(ascii(lossy.chunks, 0)).toBe('ALPH');
    // ALPH (3 bytes, padded to 4) then VP8.
    expect(ascii(lossy.chunks, 12)).toBe('VP8 ');
    expect(() => readWebpFrame(new Uint8Array(30))).toThrow(/RIFF/);
    expect(() => readWebpFrame(riff(riffChunk('EXIF', [1, 2])))).toThrow(/no VP8/);
  });

  it('writes VP8X, ANIM looping forever and one unblended ANMF per frame with its duration', () => {
    const frames = [losslessStill(20, 10, 1), lossyStill(20, 10), losslessStill(20, 10, 3)].map(readWebpFrame);
    const durations = frameDurations(3, 30, 1000);
    expect(durations).toEqual([33, 34, 33]);
    const file = concat(muxAnimatedWebp(20, 10, frames, durations));
    expect(ascii(file, 0)).toBe('RIFF');
    expect(le(file, 4, 4)).toBe(file.length - 8);
    expect(ascii(file, 8)).toBe('WEBP');
    expect(ascii(file, 12)).toBe('VP8X');
    expect(file[20]).toBe(0x12);
    expect([le(file, 24, 3) + 1, le(file, 27, 3) + 1]).toEqual([20, 10]);
    expect(ascii(file, 30)).toBe('ANIM');
    expect(le(file, 38, 4)).toBe(0);
    expect(le(file, 42, 2)).toBe(0);
    let at = 44;
    frames.forEach((frame, i) => {
      expect(ascii(file, at)).toBe('ANMF');
      const size = le(file, at + 4, 4);
      expect(size).toBe(16 + frame.chunks.length);
      const body = at + 8;
      expect([le(file, body, 3), le(file, body + 3, 3)]).toEqual([0, 0]);
      expect([le(file, body + 6, 3) + 1, le(file, body + 9, 3) + 1]).toEqual([20, 10]);
      expect(le(file, body + 12, 3)).toBe(durations[i]);
      expect(file[body + 15]).toBe(0x02);
      expect(file.subarray(body + 16, body + 16 + frame.chunks.length)).toEqual(frame.chunks);
      at = body + size;
    });
    expect(at).toBe(file.length);
  });
});

interface EbmlNode {
  readonly id: number;
  readonly data: Uint8Array;
  readonly children: EbmlNode[];
}

const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675]);

function readEbml(bytes: Uint8Array): EbmlNode[] {
  const nodes: EbmlNode[] = [];
  for (let at = 0; at < bytes.length;) {
    const first = bytes[at] ?? 0;
    const idLength = Math.clz32(first) - 23;
    const id = be(bytes, at, idLength);
    at += idLength;
    const sizeLength = Math.clz32(bytes[at] ?? 0) - 23;
    const size = be(bytes, at, sizeLength) - (0x80 >> (sizeLength - 1)) * 256 ** (sizeLength - 1);
    at += sizeLength;
    const data = bytes.subarray(at, at + size);
    nodes.push({ id, data, children: MASTERS.has(id) ? readEbml(data) : [] });
    at += size;
  }
  return nodes;
}

const child = (node: EbmlNode | undefined, id: number): EbmlNode => {
  const found = node?.children.find((c) => c.id === id);
  if (!found) throw new Error(`no element 0x${id.toString(16)}`);
  return found;
};

function videoFrames(count: number, fps: number, keyEvery: number): EncodedFrame[] {
  return Array.from({ length: count }, (_, i) => ({
    data: new Uint8Array(5 + (i % 3)).fill(i + 1),
    timestamp: Math.round((i * 1e6) / fps),
    key: i % keyEvery === 0,
  }));
}

describe('WebM muxing', () => {
  it('writes a webm track and one cluster per key frame with every block in order', () => {
    const frames = videoFrames(7, 30, 3);
    const [header, segment] = readEbml(concat(muxWebm({ codecId: 'V_VP9', width: 64, height: 48, fps: 30 }, frames)));
    expect(new TextDecoder().decode(child(header, 0x4282).data)).toBe('webm');
    const info = child(segment, 0x1549a966);
    expect(be(child(info, 0x2ad7b1).data, 0, 3)).toBe(1_000_000);
    expect(
      new DataView(child(info, 0x4489).data.buffer, child(info, 0x4489).data.byteOffset).getFloat64(0),
    ).toBeCloseTo((7 * 1000) / 30, 9);
    const track = child(child(segment, 0x1654ae6b), 0xae);
    expect(new TextDecoder().decode(child(track, 0x86).data)).toBe('V_VP9');
    const video = child(track, 0xe0);
    expect([be(child(video, 0xb0).data, 0, 1), be(child(video, 0xba).data, 0, 1)]).toEqual([64, 48]);
    const clusters = segment!.children.filter((c) => c.id === 0x1f43b675);
    expect(clusters).toHaveLength(3);
    const blocks = clusters.flatMap((cluster) => {
      const start = be(child(cluster, 0xe7).data, 0, child(cluster, 0xe7).data.length);
      return cluster.children
        .filter((c) => c.id === 0xa3)
        .map((b) => ({
          time: start + new DataView(b.data.buffer, b.data.byteOffset).getInt16(1),
          key: (b.data[3] ?? 0) & 0x80,
          data: b.data.subarray(4),
          track: b.data[0],
        }));
    });
    expect(blocks.map((b) => b.time)).toEqual(frames.map((f) => Math.round(f.timestamp / 1000)));
    expect(blocks.map((b) => b.key !== 0)).toEqual(frames.map((f) => f.key));
    blocks.forEach((b, i) => expect(b.data).toEqual(frames[i]!.data));
    expect(new Set(blocks.map((b) => b.track))).toEqual(new Set([0x81]));
  });

  it('refuses frames that do not start with a key frame or come out of order', () => {
    const track = { codecId: 'V_VP8', width: 2, height: 2, fps: 10 } as const;
    expect(() => muxWebm(track, videoFrames(2, 10, 3).reverse())).toThrow();
    expect(() => muxWebm(track, [])).toThrow(/key frame/);
  });
});

interface Box {
  readonly type: string;
  readonly start: number;
  readonly body: Uint8Array;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf']);

function readBoxes(bytes: Uint8Array, offset = 0): Box[] {
  const boxes: Box[] = [];
  for (let at = 0; at < bytes.length;) {
    const size = be(bytes, at, 4);
    boxes.push({ type: ascii(bytes, at + 4), start: offset + at, body: bytes.subarray(at + 8, at + size) });
    at += size;
  }
  return boxes;
}

function find(bytes: Uint8Array, path: string[]): Box {
  let boxes = readBoxes(bytes);
  let box: Box | undefined;
  for (const type of path) {
    box = boxes.find((b) => b.type === type);
    if (!box) throw new Error(`no ${type}`);
    if (CONTAINERS.has(type)) boxes = readBoxes(box.body, box.start + 8);
  }
  return box as Box;
}

describe('MP4 muxing', () => {
  it('writes ftyp, mdat and a moov whose sample table finds every frame', () => {
    const frames = videoFrames(5, 24, 2);
    const avcC = new Uint8Array([1, 0x64, 0, 0x1f, 0xff]);
    const file = concat(muxMp4({ width: 64, height: 48, fps: 24, avcC }, frames));
    expect(readBoxes(file).map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov']);
    const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
    const sizes = find(file, [...stbl, 'stsz']).body;
    expect(be(sizes, 8, 4)).toBe(5);
    const offsets = find(file, [...stbl, 'stco']).body;
    expect(be(offsets, 4, 4)).toBe(5);
    frames.forEach((frame, i) => {
      const size = be(sizes, 12 + i * 4, 4);
      const offset = be(offsets, 8 + i * 4, 4);
      expect(file.subarray(offset, offset + size)).toEqual(frame.data);
    });
    const stss = find(file, [...stbl, 'stss']).body;
    expect([be(stss, 4, 4), be(stss, 8, 4), be(stss, 12, 4), be(stss, 16, 4)]).toEqual([3, 1, 3, 5]);
    const stts = find(file, [...stbl, 'stts']).body;
    expect([be(stts, 4, 4), be(stts, 8, 4), be(stts, 12, 4)]).toEqual([1, 5, 1]);
    const mdhd = find(file, ['moov', 'trak', 'mdia', 'mdhd']).body;
    expect([be(mdhd, 12, 4), be(mdhd, 16, 4)]).toEqual([24, 5]);
    const stsd = find(file, [...stbl, 'stsd']).body;
    expect(ascii(stsd, 12)).toBe('avc1');
    // The sample entry: 78 bytes, then avcC.
    expect([be(stsd, 8 + 8 + 24, 2), be(stsd, 8 + 8 + 26, 2)]).toEqual([64, 48]);
    expect(ascii(stsd, 8 + 8 + 78 + 4)).toBe('avcC');
    expect(stsd.subarray(8 + 8 + 78 + 8)).toEqual(avcC);
    const tkhd = find(file, ['moov', 'trak', 'tkhd']).body;
    expect([be(tkhd, 76, 4) / 0x10000, be(tkhd, 80, 4) / 0x10000]).toEqual([64, 48]);
  });

  it('refuses frames that do not start with a key frame or come out of order', () => {
    const track = { width: 2, height: 2, fps: 10, avcC: new Uint8Array(1) };
    const frames = videoFrames(3, 10, 1);
    expect(() => muxMp4(track, [frames[0]!, frames[2]!, frames[1]!])).toThrow(/order/);
    expect(() => muxMp4(track, [{ ...frames[0]!, key: false }])).toThrow(/key frame/);
  });
});

describe('video codec choice', () => {
  it('picks the smallest VP9 and H.264 level that holds the frame, best profile first', () => {
    expect(videoCodecCandidates('webm', 64, 64, 30).map((c) => c.codec)).toEqual([
      'vp09.00.10.08',
      'vp09.00.11.08',
      'vp8',
    ]);
    expect(videoCodecCandidates('webm', 1920, 1080, 30)[0]?.codec).toBe('vp09.00.40.08');
    expect(videoCodecCandidates('mp4', 64, 64, 30).map((c) => c.codec)).toEqual([
      'avc1.64001f',
      'avc1.4d001f',
      'avc1.42e01f',
    ]);
    expect(videoCodecCandidates('mp4', 1920, 1080, 30)[0]?.codec).toBe('avc1.640028');
    expect(videoCodecCandidates('mp4', 4096, 4096, 30)[0]?.codec).toBe('avc1.64003c');
  });

  it('takes the frame rate into the level: 720p60 and 1080p60 need more than their size alone', () => {
    // H.264: 3 600 macroblocks x 60 = 216 000/s, over level 3.1 (108 000): 3.2; 8 160 x 60 = 489 600/s: 4.2.
    expect(videoCodecCandidates('mp4', 1280, 720, 30)[0]?.codec).toBe('avc1.64001f');
    expect(videoCodecCandidates('mp4', 1280, 720, 60)[0]?.codec).toBe('avc1.640020');
    expect(videoCodecCandidates('mp4', 1920, 1080, 60)[0]?.codec).toBe('avc1.64002a');
    // VP9: 921 600 x 60 = 55.3 M luma samples/s, over level 3.1 (36.9 M): 4.0; 1080p60 = 124.4 M, over 4.0: 4.1.
    expect(videoCodecCandidates('webm', 1280, 720, 30)[0]?.codec).toBe('vp09.00.31.08');
    expect(videoCodecCandidates('webm', 1280, 720, 60)[0]?.codec).toBe('vp09.00.40.08');
    expect(videoCodecCandidates('webm', 1920, 1080, 60)[0]?.codec).toBe('vp09.00.41.08');
  });
});
