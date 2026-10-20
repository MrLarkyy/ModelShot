import { constants, deflateSync, type ZlibOptions } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inflateZlib } from '../../src/png/inflateZlib';
import { seededBytes, seededRandom } from '../support/seededRandom';

/** Writes deflate's bit stream: values least significant bit first, Huffman codes most significant bit first. */
class BitWriter {
  private readonly bytes: number[] = [];
  private buffer = 0;
  private count = 0;

  constructor(header: readonly number[] = [0x78, 0x01]) {
    this.bytes.push(...header);
  }

  bits(value: number, count: number): this {
    for (let i = 0; i < count; i++) this.bit((value >> i) & 1);
    return this;
  }

  code(code: number, length: number): this {
    for (let i = length - 1; i >= 0; i--) this.bit((code >> i) & 1);
    return this;
  }

  /** Pads to a byte boundary and appends raw bytes. */
  raw(bytes: readonly number[]): this {
    this.flush();
    this.bytes.push(...bytes);
    return this;
  }

  done(): Uint8Array {
    this.flush();
    return Uint8Array.from(this.bytes);
  }

  private bit(bit: number): void {
    this.buffer |= bit << this.count;
    if (++this.count === 8) this.flush();
  }

  private flush(): void {
    if (this.count === 0) return;
    this.bytes.push(this.buffer);
    this.buffer = 0;
    this.count = 0;
  }
}

/** Canonical Huffman codes for per-symbol code lengths (RFC 1951 3.2.2). */
function canonical(lengths: readonly number[]): number[] {
  const counts = new Array<number>(16).fill(0);
  for (const length of lengths) if (length) counts[length] = (counts[length] ?? 0) + 1;
  const next = new Array<number>(16).fill(0);
  let code = 0;
  for (let bits = 1; bits < 16; bits++) {
    code = (code + (counts[bits - 1] ?? 0)) << 1;
    next[bits] = code;
  }
  return lengths.map((length) => {
    if (!length) return -1;
    const value = next[length] ?? 0;
    next[length] = value + 1;
    return value;
  });
}

/**
 * A final dynamic block header for these code lengths: the code-length code gives symbols 0..15 four bits each, so
 * every length is written as itself. Returns the writer and the literal and distance codes.
 */
function dynamicBlock(literal: readonly number[], distance: readonly number[]) {
  const w = new BitWriter().bits(1, 1).bits(2, 2);
  w.bits(literal.length - 257, 5)
    .bits(distance.length - 1, 5)
    .bits(19 - 4, 4);
  for (const symbol of [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
    w.bits(symbol < 16 ? 4 : 0, 3);
  for (const length of [...literal, ...distance]) w.code(length, 4);
  const literalCodes = canonical(literal);
  const distanceCodes = canonical(distance);
  const lit = (symbol: number) => w.code(literalCodes[symbol] ?? 0, literal[symbol] ?? 0);
  const dist = (symbol: number) => w.code(distanceCodes[symbol] ?? 0, distance[symbol] ?? 0);
  return { w, lit, dist };
}

function lengths(count: number, set: Record<number, number>): number[] {
  return Array.from({ length: count }, (_, symbol) => set[symbol] ?? 0);
}

function repetitive(length: number): Uint8Array {
  const random = seededRandom(7);
  const out = new Uint8Array(length);
  let at = 0;
  while (at < length) {
    const run = 1 + Math.floor(random() * 300);
    const kind = random();
    for (let k = 0; k < run && at < length; k++, at++) {
      out[at] = kind < 0.4 ? 0 : kind < 0.8 ? (k % 7) * 31 : Math.floor(random() * 256);
    }
  }
  return out;
}

const STRATEGIES: [string, ZlibOptions][] = [
  ['level 0 (stored)', { level: 0 }],
  ['level 1', { level: 1 }],
  ['level 6', { level: 6 }],
  ['level 9', { level: 9 }],
  ['Z_FIXED', { strategy: constants.Z_FIXED }],
  ['Z_HUFFMAN_ONLY', { strategy: constants.Z_HUFFMAN_ONLY }],
  ['Z_RLE', { strategy: constants.Z_RLE }],
];

const DATA: [string, Uint8Array][] = [
  ['seeded random', seededBytes(1, 100_000)],
  ['repetitive', repetitive(200_000)],
  ['one byte', Uint8Array.of(42)],
  ['empty', new Uint8Array(0)],
];

describe('inflateZlib', () => {
  for (const [dataName, data] of DATA) {
    it.each(STRATEGIES)(`inflates ${dataName} data deflated by node:zlib with %s`, (_name, options) => {
      const inflated = inflateZlib(new Uint8Array(deflateSync(data, options)), data.length);
      expect(inflated).toBeDefined();
      expect(Buffer.from(inflated ?? []).equals(Buffer.from(data))).toBe(true);
    });
  }

  it('inflates a stream split over a view into a larger buffer', () => {
    const data = repetitive(5000);
    const stream = deflateSync(data);
    const outer = new Uint8Array(stream.length + 20);
    outer.set(stream, 7);
    expect(inflateZlib(outer.subarray(7, 7 + stream.length), data.length)).toEqual(data);
  });

  it('accepts a single one-bit distance code (as zlib does)', () => {
    const { w, lit, dist } = dynamicBlock(lengths(258, { 97: 1, 256: 2, 257: 2 }), [1]);
    lit(97);
    lit(257);
    dist(0);
    lit(256);
    expect(inflateZlib(w.done(), 4)).toEqual(Uint8Array.from([97, 97, 97, 97]));
  });

  it('copies an overlapping match byte by byte', () => {
    // Fixed codes: literal 'x' (0x30 + 120, 8 bits), length 10 = symbol 264 (7 bits), distance 1 = code 0 (5 bits).
    const w = new BitWriter().bits(1, 1).bits(1, 2);
    w.code(0x30 + 120, 8)
      .code(264 - 256, 7)
      .code(0, 5)
      .code(0, 7);
    expect(inflateZlib(w.done(), 11)).toEqual(new Uint8Array(11).fill(120));
  });

  const zlibHeader = (cmf: number, flags: number) => [cmf, flags + ((31 - ((cmf * 256 + flags) % 31)) % 31)];
  const valid = Array.from(deflateSync(Uint8Array.from([1, 2, 3])));
  const body = valid.slice(2);

  it.each<[string, Uint8Array, number]>([
    ['an empty input', new Uint8Array(0), 0],
    ['a compression method other than 8', Uint8Array.from([...zlibHeader(0x79, 0x80), ...body]), 3],
    ['a window over 32 KiB', Uint8Array.from([...zlibHeader(0x88, 0x80), ...body]), 3],
    ['a bad FCHECK', Uint8Array.from([0x78, 0x9d, ...body]), 3],
    ['a preset dictionary', Uint8Array.from([...zlibHeader(0x78, 0xa0), 0, 0, 0, 1, ...body]), 3],
    ['block type 3', new BitWriter().bits(1, 1).bits(3, 2).done(), 0],
    [
      'a stored block whose NLEN is not ~LEN',
      new BitWriter().bits(1, 1).bits(0, 2).raw([3, 0, 0xfc, 0xfe, 1, 2, 3]).done(),
      3,
    ],
    ['a stored block past the end', new BitWriter().bits(1, 1).bits(0, 2).raw([5, 0, 0xfa, 0xff, 1, 2]).done(), 5],
    ['a stored block header past the end', new BitWriter().bits(1, 1).bits(0, 2).raw([5, 0]).done(), 5],
    [
      'a distance before the start of the output',
      new BitWriter()
        .bits(1, 1)
        .bits(1, 2)
        .code(257 - 256, 7)
        .code(0, 5)
        .code(0, 7)
        .done(),
      3,
    ],
    ['a final-block flag never set', new BitWriter().bits(0, 1).bits(1, 2).code(0, 7).done(), 0],
  ])('rejects %s', (_name, stream, expected) => {
    expect(inflateZlib(stream, expected)).toBeUndefined();
  });

  it('rejects an over-subscribed literal code', () => {
    const { w, lit } = dynamicBlock(lengths(257, { 0: 1, 1: 1, 256: 1 }), [1]);
    lit(256);
    expect(inflateZlib(w.done(), 0)).toBeUndefined();
  });

  it('rejects an incomplete literal code with more than one code', () => {
    const { w, lit } = dynamicBlock(lengths(257, { 0: 2, 256: 2 }), [1]);
    lit(0);
    lit(256);
    expect(inflateZlib(w.done(), 1)).toBeUndefined();
  });

  it('rejects an over-subscribed distance code and one with no end-of-block code', () => {
    const over = dynamicBlock(lengths(257, { 0: 1, 256: 1 }), [1, 1, 1]);
    over.lit(256);
    expect(inflateZlib(over.w.done(), 0)).toBeUndefined();
    const noEnd = dynamicBlock(lengths(257, { 0: 1, 1: 1 }), [1]);
    noEnd.lit(0);
    expect(inflateZlib(noEnd.w.done(), 1)).toBeUndefined();
  });

  it('rejects a repeat of the previous length with none before it', () => {
    // Code-length code: symbol 16 at one bit, symbol 0 at one bit; the first length is a repeat.
    const w = new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(0, 5).bits(0, 4);
    w.bits(1, 3).bits(0, 3).bits(0, 3).bits(1, 3);
    w.code(1, 1).bits(0, 2);
    expect(inflateZlib(w.done(), 0)).toBeUndefined();
  });

  it('rejects a stream cut short', () => {
    const data = seededBytes(2, 4000);
    const stream = new Uint8Array(deflateSync(data));
    for (const cut of [1, 5, 100, stream.length >> 1, stream.length - 6]) {
      expect(inflateZlib(stream.subarray(0, cut), data.length), `cut at ${cut}`).toBeUndefined();
    }
  });

  it('rejects output one byte short or one byte long of the expected length', () => {
    for (const options of [{ level: 0 }, { level: 6 }, { strategy: constants.Z_FIXED }]) {
      const data = repetitive(3000);
      const stream = new Uint8Array(deflateSync(data, options));
      expect(inflateZlib(stream, data.length + 1)).toBeUndefined();
      expect(inflateZlib(stream, data.length - 1)).toBeUndefined();
      expect(inflateZlib(stream, data.length)).toEqual(data);
    }
  });

  it('stops a zlib bomb at the expected length (64 MiB of zeros, 8 KiB expected)', () => {
    const stream = new Uint8Array(deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 }));
    expect(stream.length).toBeLessThan(100_000);
    expect(inflateZlib(stream, 8 * 1024)).toBeUndefined();
  });

  it('throws a RangeError for an invalid expected length', () => {
    const stream = new Uint8Array(deflateSync(new Uint8Array(1)));
    expect(() => inflateZlib(stream, -1)).toThrow(RangeError);
    expect(() => inflateZlib(stream, 1.5)).toThrow(RangeError);
  });

  it('never throws on corrupted streams', () => {
    const random = seededRandom(11);
    const data = repetitive(2000);
    const streams = STRATEGIES.map(([, options]) => new Uint8Array(deflateSync(data, options)));
    for (let k = 0; k < 2000; k++) {
      const stream = Uint8Array.from(streams[k % streams.length] ?? []);
      const flips = 1 + Math.floor(random() * 4);
      for (let f = 0; f < flips; f++) {
        const at = Math.floor(random() * stream.length);
        stream[at] = (stream[at] ?? 0) ^ (1 << Math.floor(random() * 8));
      }
      const result = inflateZlib(stream, data.length);
      if (result) expect(result).toHaveLength(data.length);
    }
  });
});
