const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO-HDLC, reflected polynomial 0xEDB88320) over the parts in order, as PNG chunks use it. */
export function crc32(...parts: readonly Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) crc = (CRC_TABLE[(crc ^ (part[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Adler-32, the zlib stream checksum; sums reduced every 5552 bytes, the most that cannot overflow 32 bits. */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let start = 0; start < data.length; start += 5552) {
    const end = Math.min(start + 5552, data.length);
    for (let i = start; i < end; i++) {
      a += data[i] as number;
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}
