import { EmbedError } from '../EmbedError';
import { explainFetchFailure } from './explainFetchFailure';
import { modelFileName } from './modelFileName';

/** A page visitor did not choose this download, so it is capped well below the app's 256 MiB for picked files. */
export const MAX_EMBED_MODEL_BYTES = 64 * 1024 * 1024;
/** Headers and body together; the app's load watchdog (`LOAD_TIMEOUT_MS`) is as long. */
export const MODEL_FETCH_TIMEOUT_MS = 30_000;

const MIB = 1024 * 1024;

export interface FetchModelOptions {
  readonly fetch: typeof fetch;
  /** The frame page's origin (`location.origin`): an https frame refuses http models before any request. */
  readonly frameOrigin: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly probeTimeoutMs?: number;
  /** Aborts the download when the frame shows something else; the promise then rejects with the abort reason. */
  readonly signal?: AbortSignal;
}

function tooLarge(maxBytes: number): EmbedError {
  return new EmbedError('MODEL_TOO_LARGE', `The model is larger than the embed's limit of ${maxBytes / MIB} MiB.`);
}

function timedOut(timeoutMs: number): EmbedError {
  return new EmbedError(
    'MODEL_FETCH_TIMEOUT',
    `Downloading the model took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
  );
}

/**
 * Downloads the model at `url` (checked by `parseEmbedParams`) as a `File` named after its last path segment: GET,
 * CORS, no credentials, no referrer. Fails with an `EmbedError` naming the limit: `MODEL_INSECURE`, `MODEL_HTTP_ERROR`,
 * `MODEL_TOO_LARGE` (from Content-Length before reading, else while streaming), `MODEL_FETCH_TIMEOUT`, and for a
 * request without response `MODEL_CORS_BLOCKED` or `MODEL_UNREACHABLE` (`explainFetchFailure`).
 */
export async function fetchModel(url: string, options: FetchModelOptions): Promise<File> {
  const maxBytes = options.maxBytes ?? MAX_EMBED_MODEL_BYTES;
  const timeoutMs = options.timeoutMs ?? MODEL_FETCH_TIMEOUT_MS;
  const target = new URL(url);
  if (new URL(options.frameOrigin).protocol === 'https:' && target.protocol === 'http:') {
    throw new EmbedError(
      'MODEL_INSECURE',
      `The model URL uses http, which a page served over https may not load; serve the model over https.`,
    );
  }
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onAbort);
  const stopped = (): EmbedError | null => {
    options.signal?.throwIfAborted();
    return expired ? timedOut(timeoutMs) : null;
  };
  try {
    let response: Response;
    try {
      response = await options.fetch(target.href, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } catch {
      throw (
        stopped() ??
        (await explainFetchFailure(target.href, {
          fetch: options.fetch,
          frameOrigin: options.frameOrigin,
          ...(options.probeTimeoutMs === undefined ? {} : { timeoutMs: options.probeTimeoutMs }),
        }))
      );
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new EmbedError(
        'MODEL_HTTP_ERROR',
        `The model server answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''} for ${target.href}.`,
      );
    }
    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (declared > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw tooLarge(maxBytes);
    }
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const reader = response.body?.getReader();
    let total = 0;
    while (reader) {
      let part: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
      try {
        part = await reader.read();
      } catch {
        throw (
          stopped() ??
          new EmbedError(
            'MODEL_UNREACHABLE',
            `The connection to ${target.origin} broke while the model was downloading.`,
          )
        );
      }
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw tooLarge(maxBytes);
      }
      chunks.push(part.value);
    }
    const late = stopped();
    if (late) throw late;
    return new File(chunks, modelFileName(target.href));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
