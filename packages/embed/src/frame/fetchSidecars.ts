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
}

interface Sidecar {
  readonly href: string;
  readonly name: string;
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
 * within one byte budget shared with the model and one time limit for them all. A `.bbmodel` or a self-contained model
 * makes no request.
 */
export async function fetchSidecars(model: File, modelUrl: string, options: FetchSidecarsOptions): Promise<File[]> {
  const totalBytes = options.maxBytes ?? MAX_EMBED_MODEL_BYTES;
  const timeoutMs = options.timeoutMs ?? MODEL_FETCH_TIMEOUT_MS;
  options.signal?.throwIfAborted();
  const bytes = new Uint8Array(await model.arrayBuffer());
  options.signal?.throwIfAborted();
  const format = detectModelFormat(model.name, bytes.subarray(0, 4));
  if (format !== 'gltf' && format !== 'glb' && format !== 'obj') return [];
  const limit = { maxReferences: MAX_LISTED_REFERENCES };
  const references = format === 'obj' ? listObjReferences(bytes, limit) : listGltfReferences(bytes, limit);
  const list = new SidecarList(new URL(modelUrl).origin);
  const first = list.add(references, modelUrl);
  if (first.length === 0) return [];

  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let used = model.size;
  const files: File[] = [];
  const download = async (sidecar: Sidecar): Promise<File> => {
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
    used += file.size;
    files.push(file);
    return file;
  };
  try {
    const libraries: { readonly href: string; readonly file: File }[] = [];
    for (const sidecar of first) {
      const file = await download(sidecar);
      if (format === 'obj' && sidecar.name.toLowerCase().endsWith('.mtl')) libraries.push({ href: sidecar.href, file });
    }
    const textures: Sidecar[] = [];
    for (const { href, file } of libraries) {
      const text = new Uint8Array(await file.arrayBuffer());
      textures.push(...list.add(listMtlReferences(text, limit), href));
    }
    for (const sidecar of textures) await download(sidecar);
    return files;
  } finally {
    clearTimeout(timer);
  }
}
