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

export interface FetchSidecarOptions {
  readonly fetch: typeof fetch;
  readonly frameOrigin: string;
  /** What is left of the budget the model and its files share. */
  readonly maxBytes: number;
  /** That whole budget, for the message. */
  readonly totalBytes: number;
  /** Aborts when the time all the files share is up: the download then fails with `MODEL_FETCH_TIMEOUT`. */
  readonly deadline: AbortSignal;
  readonly timeoutMs: number;
  readonly probeTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface DownloadOptions {
  readonly fetch: typeof fetch;
  readonly frameOrigin: string;
  readonly maxBytes: number;
  readonly deadline: AbortSignal;
  readonly probeTimeoutMs: number | undefined;
  readonly signal: AbortSignal | undefined;
  /** What is downloading, for a broken connection: "the model", "the model's file …". */
  readonly subject: string;
  readonly tooLarge: () => EmbedError;
  readonly timedOut: () => EmbedError;
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
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  try {
    const chunks = await download(target, {
      fetch: options.fetch,
      frameOrigin: options.frameOrigin,
      maxBytes,
      deadline: deadline.signal,
      probeTimeoutMs: options.probeTimeoutMs,
      signal: options.signal,
      subject: 'the model',
      tooLarge: () => tooLarge(maxBytes),
      timedOut: () => timedOut(timeoutMs),
    });
    return new File(chunks, modelFileName(target.href));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads one file a model refers to (`href`, already checked to be on the model's origin) as a `File` called
 * `name`, as `fetchModel` does: GET, CORS, no credentials, no referrer. The errors are `fetchModel`'s, with the file
 * named; `MODEL_TOO_LARGE` counts the model and its files together, `MODEL_FETCH_TIMEOUT` their shared time.
 */
export async function fetchSidecar(href: string, name: string, options: FetchSidecarOptions): Promise<File> {
  options.signal?.throwIfAborted();
  const target = new URL(href);
  const chunks = await download(target, {
    fetch: options.fetch,
    frameOrigin: options.frameOrigin,
    maxBytes: options.maxBytes,
    deadline: options.deadline,
    probeTimeoutMs: options.probeTimeoutMs,
    signal: options.signal,
    subject: `the model's file ${target.href}`,
    tooLarge: () =>
      new EmbedError(
        'MODEL_TOO_LARGE',
        `The model and its files are larger than the embed's limit of ${options.totalBytes / MIB} MiB; ` +
          `${target.href} went over it.`,
      ),
    timedOut: () =>
      new EmbedError(
        'MODEL_FETCH_TIMEOUT',
        `Downloading the model's files took longer than ${Math.round(options.timeoutMs / 1000)} s and was stopped ` +
          `at ${target.href}.`,
      ),
  }).catch((error: unknown) => {
    // The probe's explanation speaks of "the file"; a sidecar's names which one.
    if (error instanceof EmbedError && (error.code === 'MODEL_CORS_BLOCKED' || error.code === 'MODEL_UNREACHABLE')) {
      throw new EmbedError(error.code, `The model's file ${target.href} failed to download. ${error.message}`);
    }
    throw error;
  });
  return new File(chunks, name);
}

async function download(target: URL, options: DownloadOptions): Promise<Uint8Array<ArrayBuffer>[]> {
  const { maxBytes, deadline, signal } = options;
  const stopped = (): EmbedError | null => {
    signal?.throwIfAborted();
    return deadline.aborted ? options.timedOut() : null;
  };
  const early = stopped();
  if (early) throw early;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  const onExpire = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort);
  deadline.addEventListener('abort', onExpire);
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
      throw options.tooLarge();
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
            `The connection to ${target.origin} broke while ${options.subject} was downloading.`,
          )
        );
      }
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw options.tooLarge();
      }
      chunks.push(part.value);
    }
    const late = stopped();
    if (late) throw late;
    return chunks;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    deadline.removeEventListener('abort', onExpire);
  }
}
