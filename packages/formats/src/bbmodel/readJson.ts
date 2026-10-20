import { utf8LengthExceeds } from '../text/utf8LengthExceeds';
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
