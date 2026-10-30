import { IntakeError } from './IntakeError';
import type {
  ListMessage,
  ListReply,
  LoadedModel,
  LoadMessage,
  LoadReply,
  PlayerArmsChoice,
  ReferenceSource,
} from './LoadMessages';
import type { LoadRequest } from './groupFiles';

export const LOAD_TIMEOUT_MS = 30_000;

/** The parts of a `Worker` the loader uses (a test passes a fake). */
export interface LoadWorker {
  postMessage(message: LoadMessage | ListMessage): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<LoadReply | ListReply>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

export interface LoadOptions {
  readonly arms?: PlayerArmsChoice;
  /** The time the worker may take for the whole session: its lists and its load together. */
  readonly timeoutMs?: number;
  readonly createWorker?: () => LoadWorker;
  /** E2E build only: the worker never answers. */
  readonly hang?: boolean;
  /** Stops the read: the worker is killed and the load rejects with the signal's reason (an `AbortError`). */
  readonly signal?: AbortSignal;
}

/**
 * One model's read in one worker: its references listed (and its material libraries'), then, once the caller has the
 * files they name, the model loaded from what the list already read and parsed. One request at a time. The worker
 * ends with the load's answer, on abort, timeout, crash, a malformed answer or `close`; the session then refuses more.
 */
export interface ModelSession {
  /**
   * The files `file` refers to, at most `maxReferences + 1` (one more tells "too many"). A model's list keeps it read
   * in the worker for `load` of the same `File`; a file its loader would refuse lists nothing, and loading it says why.
   */
  readonly listReferences: (file: File, of: ReferenceSource, maxReferences: number) => Promise<string[]>;
  readonly load: (request: LoadRequest) => Promise<LoadedModel>;
  readonly close: () => void;
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('The model read was aborted.', 'AbortError');
}

function startWorker(): LoadWorker {
  return new Worker(new URL('./loadWorker.ts', import.meta.url), { type: 'module' });
}

function isReferenceList(value: unknown, maxReferences: number): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxReferences + 1 &&
    value.every((reference: unknown) => typeof reference === 'string')
  );
}

interface Pending {
  readonly answer: (reply: LoadReply | ListReply) => void;
  readonly reject: (error: Error) => void;
}

// Parses in a worker: the loaders are synchronous, so a hostile file could hang the tab. The worker is killed once the
// session has spent `timeoutMs` waiting on it (time between requests, e.g. downloads, is not counted) or on abort,
// which is the only reliable stop; every session gets a fresh worker.
export function openModel(options: LoadOptions = {}): ModelSession {
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
  const { signal } = options;
  let worker: LoadWorker | null = null;
  let ended: Error | null = null;
  let pending: Pending | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spentMs = 0;
  let opened: File | null = null;

  const end = (why: Error): void => {
    if (ended) return;
    ended = why;
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    worker?.terminate();
    worker = null;
    const waiting = pending;
    pending = null;
    waiting?.reject(why);
  };
  const aborted = (): void => end(abortReason(signal));
  if (signal?.aborted) ended = abortReason(signal);
  else signal?.addEventListener('abort', aborted, { once: true });

  const begin = (): LoadWorker => {
    const started = (options.createWorker ?? startWorker)();
    started.addEventListener('message', (event) => pending?.answer(event.data));
    const crashed = (): void => end(new IntakeError('LOAD_FAILED', 'The model reader stopped working.'));
    started.addEventListener('error', crashed);
    started.addEventListener('messageerror', crashed);
    return started;
  };

  // `prepare` runs once the request is taken, before the worker is started or asked.
  const ask = <T>(
    message: LoadMessage | ListMessage,
    accept: (reply: LoadReply | ListReply) => T,
    prepare: () => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (ended) {
        reject(ended);
        return;
      }
      if (pending) {
        reject(new Error('The model session takes one request at a time.'));
        return;
      }
      prepare();
      if (!worker) {
        try {
          worker = begin();
        } catch (error) {
          const failed = new IntakeError('LOAD_FAILED', `The model reader could not start: ${String(error)}`);
          end(failed);
          reject(failed);
          return;
        }
      }
      const startedAt = Date.now();
      pending = {
        answer: (reply) => {
          spentMs += Date.now() - startedAt;
          clearTimeout(timer);
          pending = null;
          try {
            resolve(accept(reply));
          } catch (error) {
            const failed = error instanceof Error ? error : new Error(String(error));
            end(failed);
            reject(failed);
          }
        },
        reject,
      };
      timer = setTimeout(
        () =>
          end(
            new IntakeError(
              'LOAD_TIMEOUT',
              `Reading the file took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
            ),
          ),
        Math.max(0, timeoutMs - spentMs),
      );
      worker.postMessage(message);
    });

  const listReferences = (file: File, of: ReferenceSource, maxReferences: number): Promise<string[]> => {
    const message: ListMessage = { list: { file, of, maxReferences } };
    const prepare = (): void => {
      if (of === 'model') opened = file;
    };
    return ask(
      message,
      (reply) => {
        if (!reply.ok) throw new IntakeError(reply.code, reply.message);
        const references: unknown = 'references' in reply ? reply.references : undefined;
        if (!isReferenceList(references, maxReferences)) {
          throw new IntakeError('LOAD_FAILED', 'The model reader gave an answer that is not a list of files.');
        }
        return [...references];
      },
      prepare,
    );
  };

  const load = (request: LoadRequest): Promise<LoadedModel> => {
    // The worker holds the model a list read; any other file is read by a fresh one, never mistaken for it.
    const prepare = (): void => {
      if (worker && !(request.kind === 'model' && request.model === opened)) {
        worker.terminate();
        worker = null;
      }
      opened = null;
    };
    const message: LoadMessage = { request, arms: options.arms ?? 'classic', ...(options.hang ? { hang: true } : {}) };
    return ask(
      message,
      (reply) => {
        end(new DOMException('The model was read.', 'InvalidStateError'));
        if (!reply.ok) throw new IntakeError(reply.code, reply.message);
        return reply as LoadedModel;
      },
      prepare,
    );
  };

  const close = (): void => end(new DOMException('The model read was closed.', 'AbortError'));

  return { listReferences, load, close };
}
