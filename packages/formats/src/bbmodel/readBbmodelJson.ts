import { utf8Length } from '../text/utf8Length';
import { BbmodelError } from './BbmodelError';
import { readJson } from './readJson';

/**
 * A `.bbmodel` file parsed once, for `listBbmodelReferences` and `loadBbmodel` to share. `root` is untyped until the
 * loader checks it. Only a container `readBbmodelJson` returned is taken as one.
 */
export interface BbmodelJson {
  readonly root: unknown;
  /** Size of the file it was read from (UTF-8 bytes for text). */
  readonly byteLength: number;
}

// A caller-made object could hold getters, cycles or values JSON cannot hold; only what this module parsed is taken.
const READ = new WeakSet<object>();

/**
 * Size-checks, decodes (strict UTF-8) and parses the file as the loader does. A container this function returned is
 * checked against `maxFileBytes` again and returned as it is, read no more.
 */
export function readBbmodelJson(input: string | Uint8Array | BbmodelJson, maxFileBytes: number): BbmodelJson {
  if (typeof input === 'object' && !(input instanceof Uint8Array) && READ.has(input)) {
    if (input.byteLength > maxFileBytes) {
      throw new BbmodelError('FILE_TOO_LARGE', '$', `${input.byteLength} bytes, the limit is ${maxFileBytes}`);
    }
    return input;
  }
  const root = readJson(input as string | Uint8Array, maxFileBytes);
  const byteLength = typeof input === 'string' ? utf8Length(input) : (input as Uint8Array).byteLength;
  const container: BbmodelJson = { root, byteLength };
  READ.add(container);
  return container;
}
