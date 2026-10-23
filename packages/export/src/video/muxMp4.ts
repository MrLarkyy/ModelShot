import { ByteWriter } from '../ByteWriter';
import { ExportError } from '../ExportError';
import type { EncodedFrame } from './EncodedFrame';

export interface Mp4Track {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** The AVCDecoderConfigurationRecord (`avcC`), WebCodecs' `decoderConfig.description` in avc format. */
  readonly avcC: Uint8Array<ArrayBuffer>;
}

const MOVIE_TIMESCALE = 1000;
const UNITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

const box = (type: string, ...payload: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const w = new ByteWriter().u32(8 + payload.reduce((n, p) => n + p.length, 0)).ascii(type);
  for (const p of payload) w.bytes(p);
  return w.toBytes();
};

const fullBox = (type: string, version: number, flags: number, body: ByteWriter, ...children: Uint8Array[]) =>
  box(type, new ByteWriter().u8(version).u24(flags).toBytes(), body.toBytes(), ...children);

const matrix = (w: ByteWriter): ByteWriter => {
  for (const v of UNITY_MATRIX) w.u32(v);
  return w;
};

function sampleEntry(track: Mp4Track): Uint8Array<ArrayBuffer> {
  const w = new ByteWriter();
  for (let i = 0; i < 6; i++) w.u8(0);
  w.u16(1).u16(0).u16(0).u32(0).u32(0).u32(0);
  w.u16(track.width).u16(track.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
  for (let i = 0; i < 32; i++) w.u8(0);
  w.u16(0x0018).i16(-1);
  return box('avc1', w.toBytes(), box('avcC', track.avcC));
}

/**
 * An MP4 (ISO BMFF) of one H.264 track: ftyp, mdat with every frame in order, then moov (the sample table needs the
 * sizes, which are known only at the end). One sample per chunk, each 1 / fps long (media timescale fps), key frames
 * in stss, 32-bit chunk offsets (the output limit keeps files far under 4 GiB; checked anyway). The frames must come
 * in presentation order, the first a key frame, else `ENCODER_FAILED`. Returns the file as parts.
 */
export function muxMp4(track: Mp4Track, frames: readonly EncodedFrame[]): Uint8Array<ArrayBuffer>[] {
  if (frames.length === 0 || !frames[0]?.key)
    throw new ExportError('ENCODER_FAILED', 'the video has no first key frame');
  for (let i = 1; i < frames.length; i++) {
    if ((frames[i]?.timestamp ?? 0) <= (frames[i - 1]?.timestamp ?? 0)) {
      throw new ExportError('ENCODER_FAILED', 'video frames came out of order (reordered frames are not supported)');
    }
  }
  const ftyp = box(
    'ftyp',
    new ByteWriter().ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('avc1').ascii('mp41').toBytes(),
  );
  const dataSize = frames.reduce((n, f) => n + f.data.length, 0);
  if (8 + dataSize > 0xffffffff) throw new ExportError('LIMIT_EXCEEDED', 'the video passes 4 GiB', 'frames');
  const mdatHeader = new ByteWriter()
    .u32(8 + dataSize)
    .ascii('mdat')
    .toBytes();
  const offsets: number[] = [];
  let offset = ftyp.length + mdatHeader.length;
  for (const frame of frames) {
    offsets.push(offset);
    offset += frame.data.length;
  }
  const count = frames.length;
  const movieDuration = Math.round((count * MOVIE_TIMESCALE) / track.fps);
  const keys = frames.flatMap((f, i) => (f.key ? [i + 1] : []));

  const stts = new ByteWriter().u32(1).u32(count).u32(1);
  const stss = new ByteWriter().u32(keys.length);
  for (const k of keys) stss.u32(k);
  const stsc = new ByteWriter().u32(1).u32(1).u32(1).u32(1);
  const stsz = new ByteWriter().u32(0).u32(count);
  for (const f of frames) stsz.u32(f.data.length);
  const stco = new ByteWriter().u32(count);
  for (const o of offsets) stco.u32(o);
  const stbl = box(
    'stbl',
    fullBox('stsd', 0, 0, new ByteWriter().u32(1), sampleEntry(track)),
    fullBox('stts', 0, 0, stts),
    fullBox('stss', 0, 0, stss),
    fullBox('stsc', 0, 0, stsc),
    fullBox('stsz', 0, 0, stsz),
    fullBox('stco', 0, 0, stco),
  );
  const dinf = box('dinf', fullBox('dref', 0, 0, new ByteWriter().u32(1), fullBox('url ', 0, 1, new ByteWriter())));
  const minf = box('minf', fullBox('vmhd', 0, 1, new ByteWriter().u16(0).u16(0).u16(0).u16(0)), dinf, stbl);
  // Language "und", packed as three 5-bit letters.
  const mdhd = fullBox('mdhd', 0, 0, new ByteWriter().u32(0).u32(0).u32(track.fps).u32(count).u16(0x55c4).u16(0));
  const hdlr = fullBox(
    'hdlr',
    0,
    0,
    new ByteWriter().u32(0).ascii('vide').u32(0).u32(0).u32(0).ascii('VideoHandler').u8(0),
  );
  const tkhd = fullBox(
    'tkhd',
    0,
    3,
    matrix(new ByteWriter().u32(0).u32(0).u32(1).u32(0).u32(movieDuration).u32(0).u32(0).u16(0).u16(0).u16(0).u16(0))
      .u32(track.width * 0x10000)
      .u32(track.height * 0x10000),
  );
  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    matrix(
      new ByteWriter()
        .u32(0)
        .u32(0)
        .u32(MOVIE_TIMESCALE)
        .u32(movieDuration)
        .u32(0x00010000)
        .u16(0x0100)
        .u16(0)
        .u32(0)
        .u32(0),
    )
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(2),
  );
  const moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)));
  return [ftyp, mdatHeader, ...frames.map((f) => f.data), moov];
}
