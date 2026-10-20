/**
 * Whether `text` encoded as UTF-8 is longer than `maxBytes`, without encoding it. A UTF-16 unit encodes to 1–3 UTF-8
 * bytes (a surrogate pair to 4), so the exact count is only needed in between.
 */
export function utf8LengthExceeds(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) return true;
  if (text.length * 3 <= maxBytes) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > maxBytes) return true;
  }
  return false;
}
