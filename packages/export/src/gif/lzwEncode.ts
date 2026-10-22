const MAX_CODES = 4096;

/**
 * GIF's variable-length LZW (codes of minCodeSize + 1 up to 12 bits, packed least significant bit first) of palette
 * `indices`: a clear code first, a clear again when the 4096 codes are used up, the end code last.
 */
export function lzwEncode(indices: Uint8Array, minCodeSize = 8): Uint8Array<ArrayBuffer> {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
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
  let table = new Map<number, number>();
  write(clear);
  if (indices.length > 0) {
    let prefix = indices[0] as number;
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i] as number;
      const key = (prefix << 8) | k;
      const code = table.get(key);
      if (code !== undefined) {
        prefix = code;
        continue;
      }
      write(prefix);
      if (next < MAX_CODES) {
        table.set(key, next++);
        // The decoder adds each code one step later, so it widens when it has used every code of this size.
        if (next > 1 << codeSize && codeSize < 12) codeSize++;
      } else {
        write(clear);
        table = new Map();
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
