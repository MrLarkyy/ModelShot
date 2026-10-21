function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const uint32 = (value: number): number[] => [
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];

function chunk(type: string, data: Uint8Array): number[] {
  const body = Uint8Array.from([...[...type].map((c) => c.charCodeAt(0)), ...data]);
  return [...uint32(data.length), ...body, ...uint32(crc32(body))];
}

/**
 * An RGBA8 PNG of `rgba` (rows top to bottom, straight alpha) with stored (uncompressed) deflate blocks: the bytes
 * depend on the pixels only, never on a browser's encoder, so generated test textures stay identical.
 */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const zlib: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const block = raw.subarray(at, Math.min(raw.length, at + 65535));
    const final = at + 65535 >= raw.length ? 1 : 0;
    zlib.push(
      final,
      block.length & 255,
      block.length >>> 8,
      ~block.length & 255,
      (~block.length >>> 8) & 255,
      ...block,
    );
  }
  zlib.push(...uint32(adler32(raw)));
  const header = Uint8Array.from([...uint32(width), ...uint32(height), 8, 6, 0, 0, 0]);
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', header),
    ...chunk('IDAT', Uint8Array.from(zlib)),
    ...chunk('IEND', new Uint8Array(0)),
  ]);
}
