const MAX_CODES = 4096;
// The string table, keyed by prefix code × 256 + next index: codes, valid where the stamp is the current table's.
const TABLE_KEYS = MAX_CODES * 256;

/**
 * GIF's variable-length LZW (codes of minCodeSize + 1 up to 12 bits, packed least significant bit first) of palette
 * `indices`: a clear code first, a clear again when the 4096 codes are used up, the end code last. The table is a
 * typed array cleared by a generation stamp, so a code costs one array read.
 */
export function lzwEncode(indices: Uint8Array, minCodeSize = 8): Uint8Array<ArrayBuffer> {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const codes = new Uint16Array(TABLE_KEYS);
  const stamps = new Uint16Array(TABLE_KEYS);
  let generation = 1;
  let out = new Uint8Array(Math.max(256, indices.length >> 1));
  let length = 0;
  let bits = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const write = (code: number): void => {
    bits |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      if (length === out.length) {
        const grown = new Uint8Array(out.length * 2);
        grown.set(out);
        out = grown;
      }
      out[length++] = bits & 0xff;
      bits >>>= 8;
      bitCount -= 8;
    }
  };
  let next = end + 1;
  write(clear);
  if (indices.length > 0) {
    let prefix = indices[0] as number;
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i] as number;
      const key = (prefix << 8) | k;
      if (stamps[key] === generation) {
        prefix = codes[key] as number;
        continue;
      }
      write(prefix);
      if (next < MAX_CODES) {
        codes[key] = next++;
        stamps[key] = generation;
        // The decoder adds each code one step later, so it widens when it has used every code of this size.
        if (next > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        write(clear);
        generation++;
        if (generation === 0x10000) {
          stamps.fill(0);
          generation = 1;
        }
        next = end + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = k;
    }
    write(prefix);
  }
  write(end);
  if (bitCount > 0) {
    if (length === out.length) {
      const grown = new Uint8Array(out.length + 1);
      grown.set(out);
      out = grown;
    }
    out[length++] = bits & 0xff;
  }
  return out.slice(0, length);
}
