const MAX_BITS = 15;
const MAX_LITERAL_CODES = 286;
const MAX_DISTANCE_CODES = 30;
const FIXED_LITERAL_CODES = 288;
const END_OF_BLOCK = 256;

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
];
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols ordered by code. */
interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

/** Thrown inside the inflater only, turned into `undefined` at the boundary. */
class Malformed extends Error {}

/**
 * The bytes of a zlib stream (RFC 1950 around RFC 1951 deflate), which must inflate to exactly `expectedLength` bytes.
 * Returns `undefined` for anything else: a bad header, a preset dictionary, a malformed or truncated block, a distance
 * before the start, or output shorter or longer than expected. Never allocates more than `expectedLength` bytes and
 * stops at the first byte past it, so a small stream claiming a huge output costs nothing. The Adler-32 trailer is not
 * checked.
 */
export function inflateZlib(data: Uint8Array, expectedLength: number): Uint8Array | undefined {
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0) {
    throw new RangeError('expectedLength must be a non-negative integer');
  }
  if (data.length < 2) return undefined;
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  const deflate = (cmf & 0x0f) === 8 && cmf >> 4 <= 7;
  if (!deflate || (cmf * 256 + flg) % 31 !== 0 || (flg & 0x20) !== 0) return undefined;
  try {
    return new Inflater(data, 2, expectedLength).run();
  } catch (error) {
    if (error instanceof Malformed) return undefined;
    throw error;
  }
}

class Inflater {
  private bitBuffer = 0;
  private bitCount = 0;
  private outAt = 0;
  private readonly out: Uint8Array;

  constructor(
    private readonly data: Uint8Array,
    private at: number,
    private readonly expectedLength: number,
  ) {
    this.out = new Uint8Array(expectedLength);
  }

  run(): Uint8Array {
    let last = false;
    while (!last) {
      last = this.bits(1) === 1;
      const type = this.bits(2);
      if (type === 0) this.stored();
      else if (type === 1) this.codes(FIXED.literal, FIXED.distance);
      else if (type === 2) this.dynamic();
      else throw new Malformed();
    }
    if (this.outAt !== this.expectedLength) throw new Malformed();
    return this.out;
  }

  /** `count` bits (at most 16), least significant first. */
  private bits(count: number): number {
    let value = this.bitBuffer;
    while (this.bitCount < count) {
      if (this.at >= this.data.length) throw new Malformed();
      value |= (this.data[this.at++] ?? 0) << this.bitCount;
      this.bitCount += 8;
    }
    this.bitBuffer = value >>> count;
    this.bitCount -= count;
    return value & ((1 << count) - 1);
  }

  private stored(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
    if (this.at + 4 > this.data.length) throw new Malformed();
    const d = this.data;
    const length = (d[this.at] ?? 0) | ((d[this.at + 1] ?? 0) << 8);
    const inverse = (d[this.at + 2] ?? 0) | ((d[this.at + 3] ?? 0) << 8);
    this.at += 4;
    if (length !== (~inverse & 0xffff)) throw new Malformed();
    if (this.at + length > d.length || this.outAt + length > this.expectedLength) throw new Malformed();
    this.out.set(d.subarray(this.at, this.at + length), this.outAt);
    this.at += length;
    this.outAt += length;
  }

  private dynamic(): void {
    const literalCount = this.bits(5) + 257;
    const distanceCount = this.bits(5) + 1;
    const codeLengthCount = this.bits(4) + 4;
    if (literalCount > MAX_LITERAL_CODES || distanceCount > MAX_DISTANCE_CODES) throw new Malformed();
    const codeLengths = new Uint8Array(19);
    for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i] ?? 0] = this.bits(3);
    const codeLengthCode = huffman(codeLengths);
    if (codeLengthCode.left !== 0) throw new Malformed();

    const lengths = new Uint8Array(literalCount + distanceCount);
    let i = 0;
    while (i < lengths.length) {
      const symbol = this.decode(codeLengthCode.code);
      if (symbol < 16) {
        lengths[i++] = symbol;
        continue;
      }
      let value = 0;
      let repeat: number;
      if (symbol === 16) {
        if (i === 0) throw new Malformed();
        value = lengths[i - 1] ?? 0;
        repeat = 3 + this.bits(2);
      } else if (symbol === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (i + repeat > lengths.length) throw new Malformed();
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (lengths[END_OF_BLOCK] === 0) throw new Malformed();
    const literal = huffman(lengths.subarray(0, literalCount));
    const distance = huffman(lengths.subarray(literalCount));
    if (!usable(literal, literalCount) || !usable(distance, distanceCount)) throw new Malformed();
    this.codes(literal.code, distance.code);
  }

  private codes(literal: Huffman, distance: Huffman): void {
    const out = this.out;
    for (;;) {
      let symbol = this.decode(literal);
      if (symbol < END_OF_BLOCK) {
        if (this.outAt >= this.expectedLength) throw new Malformed();
        out[this.outAt++] = symbol;
        continue;
      }
      if (symbol === END_OF_BLOCK) return;
      symbol -= 257;
      if (symbol >= LENGTH_BASE.length) throw new Malformed();
      const length = (LENGTH_BASE[symbol] ?? 0) + this.bits(LENGTH_EXTRA[symbol] ?? 0);
      const distanceSymbol = this.decode(distance);
      if (distanceSymbol >= DISTANCE_BASE.length) throw new Malformed();
      const back = (DISTANCE_BASE[distanceSymbol] ?? 0) + this.bits(DISTANCE_EXTRA[distanceSymbol] ?? 0);
      if (back > this.outAt || this.outAt + length > this.expectedLength) throw new Malformed();
      // Byte by byte: a match may overlap the bytes it is copying (distance shorter than length).
      for (let k = 0; k < length; k++, this.outAt++) out[this.outAt] = out[this.outAt - back] ?? 0;
    }
  }

  /** One symbol, reading the code bit by bit (deflate stores Huffman codes most significant bit first). */
  private decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= MAX_BITS; length++) {
      if (this.bitCount === 0) {
        if (this.at >= this.data.length) throw new Malformed();
        this.bitBuffer = this.data[this.at++] ?? 0;
        this.bitCount = 8;
      }
      code |= this.bitBuffer & 1;
      this.bitBuffer >>>= 1;
      this.bitCount--;
      const count = h.counts[length] ?? 0;
      if (code - first < count) return h.symbols[index + code - first] ?? 0;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Malformed();
  }
}

/**
 * The canonical code for per-symbol code lengths (0 = unused), and how many codes of the full 2^15 space are left
 * unused: 0 for a complete code, negative for an over-subscribed one.
 */
function huffman(lengths: Uint8Array): { code: Huffman; left: number } {
  const counts = new Uint16Array(MAX_BITS + 1);
  for (const length of lengths) counts[length] = (counts[length] ?? 0) + 1;
  const code = { counts, symbols: new Uint16Array(lengths.length) };
  if (counts[0] === lengths.length) return { code, left: 0 };
  let left = 1;
  for (let length = 1; length <= MAX_BITS; length++) {
    left = (left << 1) - (counts[length] ?? 0);
    if (left < 0) return { code, left };
  }
  const offsets = new Uint16Array(MAX_BITS + 1);
  for (let length = 1; length < MAX_BITS; length++)
    offsets[length + 1] = (offsets[length] ?? 0) + (counts[length] ?? 0);
  lengths.forEach((length, symbol) => {
    if (length === 0) return;
    const at = offsets[length] ?? 0;
    code.symbols[at] = symbol;
    offsets[length] = at + 1;
  });
  return { code, left };
}

/** Complete, or incomplete with at most one code of length 1 (zlib accepts a single distance code, or none). */
function usable({ code, left }: { code: Huffman; left: number }, symbolCount: number): boolean {
  if (left === 0) return true;
  return left > 0 && (code.counts[0] ?? 0) + (code.counts[1] ?? 0) === symbolCount;
}

const FIXED = (() => {
  const lengths = new Uint8Array(FIXED_LITERAL_CODES + MAX_DISTANCE_CODES);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, FIXED_LITERAL_CODES);
  lengths.fill(5, FIXED_LITERAL_CODES);
  return {
    literal: huffman(lengths.subarray(0, FIXED_LITERAL_CODES)).code,
    distance: huffman(lengths.subarray(FIXED_LITERAL_CODES)).code,
  };
})();
