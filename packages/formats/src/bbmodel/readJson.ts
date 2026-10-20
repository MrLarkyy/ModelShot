import { BbmodelError } from './BbmodelError';

/** Size-checks, decodes (strict UTF-8) and parses the file; the result is untyped until the field readers check it. */
export function readJson(input: string | Uint8Array, maxFileBytes: number): unknown {
  let text: string;
  if (typeof input === 'string') {
    if (utf8LengthExceeds(input, maxFileBytes)) {
      throw new BbmodelError('FILE_TOO_LARGE', '$', `more than the limit of ${maxFileBytes} bytes`);
    }
    text = input.startsWith('\uFEFF') ? input.slice(1) : input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > maxFileBytes) {
      throw new BbmodelError('FILE_TOO_LARGE', '$', `${input.byteLength} bytes, the limit is ${maxFileBytes}`);
    }
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new BbmodelError('NOT_JSON', '$', 'expected UTF-8 text');
    }
  } else {
    throw new BbmodelError('NOT_JSON', '$', 'expected the file as a string or bytes');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // SyntaxError, or RangeError on pathological input; the engine's message may quote the file, so it is dropped.
    throw new BbmodelError('NOT_JSON', '$', 'expected a JSON document');
  }
}

// A UTF-16 unit encodes to 1–3 UTF-8 bytes (a surrogate pair to 4), so the exact count is only needed in between.
function utf8LengthExceeds(text: string, maxBytes: number): boolean {
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
