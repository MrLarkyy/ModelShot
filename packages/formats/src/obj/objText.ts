import { utf8Length } from '../text/utf8Length';
import { utf8LengthExceeds } from '../text/utf8LengthExceeds';
import { ObjError } from './ObjError';

/** One statement of an OBJ or MTL file: keyword, whitespace-separated arguments, and where it is. */
export interface ObjStatement {
  readonly keyword: string;
  readonly args: readonly string[];
  /** The line from argument `index` to its end, inner whitespace kept (file names with spaces). */
  readonly rest: (index: number) => string;
  /** `<file>:<line>` of the statement's first line. */
  readonly path: string;
}

/**
 * An `.obj` decoded once by `decodeObjText`, for `listObjReferences` and `loadObj` to share. The text is not given to
 * them as a string: its UTF-8 length can differ from the file's (a replaced byte is 3) and a second byte-order mark
 * would be dropped, so the file's own size is kept with it.
 */
export interface DecodedObjText {
  readonly text: string;
  /** Size of the file it was decoded from (UTF-8 bytes for text). */
  readonly byteLength: number;
}

// Only text this module decoded is taken as decoded: a caller-made object could carry a size that is not the file's.
const DECODED = new WeakSet<object>();

/** `readObjText` once, keeping the file's size: the result loads and lists without decoding again. */
export function decodeObjText(input: string | Uint8Array, fileName: string, maxFileBytes: number): DecodedObjText {
  const text = readObjText(input, fileName, maxFileBytes);
  const decoded: DecodedObjText = {
    text,
    byteLength: typeof input === 'string' ? utf8Length(input) : input.byteLength,
  };
  DECODED.add(decoded);
  return decoded;
}

/**
 * Size-checks and decodes a text file: UTF-8 with invalid bytes replaced (OBJ files from old tools are not always
 * valid UTF-8, and only ASCII keywords matter), a leading byte-order mark dropped. Text from `decodeObjText` is
 * size-checked again and returned as it was decoded.
 */
export function readObjText(
  input: string | Uint8Array | DecodedObjText,
  fileName: string,
  maxFileBytes: number,
): string {
  if (typeof input === 'object' && !(input instanceof Uint8Array) && DECODED.has(input)) {
    if (input.byteLength > maxFileBytes) {
      throw new ObjError('FILE_TOO_LARGE', fileName, `${input.byteLength} bytes, the limit is ${maxFileBytes}`);
    }
    return input.text;
  }
  let text: string;
  if (typeof input === 'string') {
    if (utf8LengthExceeds(input, maxFileBytes)) {
      throw new ObjError('FILE_TOO_LARGE', fileName, `more than the limit of ${maxFileBytes} bytes`);
    }
    text = input;
  } else if (input instanceof Uint8Array) {
    if (input.byteLength > maxFileBytes) {
      throw new ObjError('FILE_TOO_LARGE', fileName, `${input.byteLength} bytes, the limit is ${maxFileBytes}`);
    }
    text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(input);
  } else {
    throw new ObjError('INVALID_STATEMENT', fileName, 'expected the file as a string or bytes');
  }
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/**
 * Calls `visit` for every statement, in order. Lines end at LF (a CR before it is dropped); a line ending in a
 * backslash continues on the next. A logical line longer than `maxLineChars` fails before it is split. Comment and
 * blank lines are skipped. Linear in the file size: a plain character scan, no regular expressions.
 */
export function forEachStatement(
  text: string,
  fileName: string,
  maxLineChars: number,
  visit: (statement: ObjStatement) => void,
): void {
  let position = 0;
  let lineNumber = 0;
  while (position < text.length) {
    const firstLine = lineNumber + 1;
    let logical = '';
    for (;;) {
      let end = text.indexOf('\n', position);
      if (end < 0) end = text.length;
      if (end - position > maxLineChars + 1 || logical.length + (end - position) > maxLineChars + 1) {
        throw new ObjError('LINE_TOO_LONG', `${fileName}:${firstLine}`, `longer than ${maxLineChars} characters`);
      }
      let line = text.slice(position, end);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      position = end + 1;
      lineNumber++;
      if (line.endsWith('\\') && position < text.length) {
        logical += `${line.slice(0, -1)} `;
        continue;
      }
      logical += line;
      break;
    }
    if (logical.length > maxLineChars) {
      throw new ObjError('LINE_TOO_LONG', `${fileName}:${firstLine}`, `longer than ${maxLineChars} characters`);
    }
    const tokens = tokenize(logical);
    const keyword = tokens[0];
    if (!keyword || logical.charAt(keyword.start) === '#') continue;
    const name = logical.slice(keyword.start, keyword.end);
    const args = tokens.slice(1);
    visit({
      keyword: name,
      args: args.map((token) => logical.slice(token.start, token.end)),
      rest: (index) => {
        const from = args[index];
        const to = args[args.length - 1];
        return from && to ? logical.slice(from.start, to.end) : '';
      },
      path: `${fileName}:${firstLine}`,
    });
  }
}

function tokenize(line: string): { start: number; end: number }[] {
  const tokens: { start: number; end: number }[] = [];
  let start = -1;
  for (let i = 0; i <= line.length; i++) {
    const code = i < line.length ? line.charCodeAt(i) : 32;
    const space = code === 32 || code === 9 || code === 11 || code === 12;
    if (space && start >= 0) {
      tokens.push({ start, end: i });
      start = -1;
    } else if (!space && start < 0) start = i;
  }
  return tokens;
}
