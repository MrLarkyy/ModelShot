import { detectModelFormat, listGltfReferences, listMtlReferences, listObjReferences } from '@modelshot/formats';
import { EmbedError } from '../EmbedError';
import { MAX_EMBED_MODEL_BYTES, MODEL_FETCH_TIMEOUT_MS, fetchSidecar } from './fetchModel';
import { resolveSidecarUrl } from './resolveSidecarUrl';

/** The model and its files together stay within the app intake's 32 files. */
export const MAX_EMBED_SIDECARS = 31;

/**
 * More references than any model the loaders take can hold (glTF: 256 buffers and 64 images; OBJ: 256 libraries or
 * materials), so a full list means the model is refused either way, and nothing past it goes unchecked.
 */
const MAX_LISTED_REFERENCES = 512;

export interface FetchSidecarsOptions {
  readonly fetch: typeof fetch;
  readonly frameOrigin: string;
  /** Aborts the downloads when the frame shows something else; the promise then rejects with the abort reason. */
  readonly signal?: AbortSignal;
  /** The model and its files together. */
  readonly maxBytes?: number;
  /** All the files together, from the first request. */
  readonly timeoutMs?: number;
  readonly probeTimeoutMs?: number;
  /**
   * Lists what the model (`of: "model"`) or a downloaded material library refers to, at most `maxReferences + 1`.
   * The frame passes its load worker's, so the model is read and parsed there, once, off this thread; without it the
   * files are read and listed here.
   */
  readonly listReferences?: ReferenceLister;
}

export type ReferenceLister = (
  file: File,
  of: 'model' | 'library',
  maxReferences: number,
) => Promise<readonly string[]>;

interface Sidecar {
  readonly href: string;
  readonly name: string;
}

async function listHere(file: File, of: 'model' | 'library', maxReferences: number): Promise<readonly string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const limit = { maxReferences };
  if (of === 'library') return listMtlReferences(bytes, limit);
  const format = detectModelFormat(file.name, bytes.subarray(0, 4));
  return format === 'obj' ? listObjReferences(bytes, limit) : listGltfReferences(bytes, limit);
}

function tooMany(): EmbedError {
  return new EmbedError(
    'TOO_MANY_SIDECARS',
    `The model refers to more than ${MAX_EMBED_SIDECARS} files; the embed downloads at most ${MAX_EMBED_SIDECARS} ` +
      `next to a model.`,
  );
}

/** The files to download, each URL once and each file name once (the loader finds a file by its name). */
class SidecarList {
  readonly planned: Sidecar[] = [];
  private readonly byName = new Map<string, string>();

  constructor(private readonly modelOrigin: string) {}

  /** Resolves every reference against `baseUrl`; a refused one or a name clash throws, before any request. */
  add(references: readonly string[], baseUrl: string): Sidecar[] {
    if (references.length > MAX_LISTED_REFERENCES) throw tooMany();
    const added: Sidecar[] = [];
    for (const reference of references) {
      const resolved = resolveSidecarUrl(reference, baseUrl, this.modelOrigin);
      if (resolved.kind === 'refuse') throw resolved.error;
      if (resolved.kind === 'skip') continue;
      const key = resolved.name.toLowerCase();
      const known = this.byName.get(key);
      if (known === resolved.href) continue;
      if (known !== undefined) {
        throw new EmbedError(
          'SIDECAR_REFUSED',
          `The model refers to two files named ${JSON.stringify(resolved.name)}, ${known} and ${resolved.href}; the ` +
            `embed finds a file by its name, so it cannot tell them apart. Give them different names.`,
        );
      }
      this.byName.set(key, resolved.href);
      const sidecar = { href: resolved.href, name: resolved.name };
      this.planned.push(sidecar);
      added.push(sidecar);
    }
    if (this.planned.length > MAX_EMBED_SIDECARS) throw tooMany();
    return added;
  }
}

/**
 * Downloads the files a glTF or OBJ model refers to (buffers, images, material libraries and their textures) from the
 * model's own server, as the app would read them picked next to the model. Every reference is checked
 * (`resolveSidecarUrl`), counted and named before the first request; OBJ textures resolve against their MTL's URL and
 * are checked before any texture request. The downloads run one after another, with `fetchModel`'s request options,
 * within one byte budget shared with the model and one time limit for them all. A file the server answers an error
 * status for (404, 403, 500) is left out, for the loader to report missing. A `.bbmodel` or a self-contained model
 * makes no request, and a `.bbmodel` or a skin is not even read.
 */
export async function fetchSidecars(model: File, modelUrl: string, options: FetchSidecarsOptions): Promise<File[]> {
  const totalBytes = options.maxBytes ?? MAX_EMBED_MODEL_BYTES;
  const timeoutMs = options.timeoutMs ?? MODEL_FETCH_TIMEOUT_MS;
  options.signal?.throwIfAborted();
  const head = new Uint8Array(await model.slice(0, 4).arrayBuffer());
  options.signal?.throwIfAborted();
  const format = detectModelFormat(model.name, head);
  if (format !== 'gltf' && format !== 'glb' && format !== 'obj') return [];
  const listReferences = options.listReferences ?? listHere;
  const references = await listReferences(model, 'model', MAX_LISTED_REFERENCES);
  options.signal?.throwIfAborted();
  const list = new SidecarList(new URL(modelUrl).origin);
  const first = list.add(references, modelUrl);
  if (first.length === 0) return [];

  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let used = model.size;
  const files: File[] = [];
  const download = async (sidecar: Sidecar): Promise<File | null> => {
    timer ??= setTimeout(() => deadline.abort(), timeoutMs);
    const file = await fetchSidecar(sidecar.href, sidecar.name, {
      fetch: options.fetch,
      frameOrigin: options.frameOrigin,
      maxBytes: Math.max(0, totalBytes - used),
      totalBytes,
      deadline: deadline.signal,
      timeoutMs,
      ...(options.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: options.probeTimeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (file === null) return null;
    used += file.size;
    files.push(file);
    return file;
  };
  try {
    const libraries: { readonly href: string; readonly file: File }[] = [];
    for (const sidecar of first) {
      const file = await download(sidecar);
      if (file && format === 'obj' && sidecar.name.toLowerCase().endsWith('.mtl'))
        libraries.push({ href: sidecar.href, file });
    }
    const textures: Sidecar[] = [];
    for (const { href, file } of libraries) {
      const references = await listReferences(file, 'library', MAX_LISTED_REFERENCES);
      options.signal?.throwIfAborted();
      textures.push(...list.add(references, href));
    }
    for (const sidecar of textures) await download(sidecar);
    return files;
  } finally {
    clearTimeout(timer);
  }
}
