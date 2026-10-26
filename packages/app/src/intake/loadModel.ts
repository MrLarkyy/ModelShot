import { IntakeError } from './IntakeError';
import type { LoadedModel, LoadMessage, LoadReply, PlayerArmsChoice } from './LoadMessages';
import type { LoadRequest } from './groupFiles';

export const LOAD_TIMEOUT_MS = 30_000;

/** The parts of a `Worker` the loader uses (a test passes a fake). */
export interface LoadWorker {
  postMessage(message: LoadMessage): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<LoadReply>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
}

export interface LoadOptions {
  readonly arms?: PlayerArmsChoice;
  readonly timeoutMs?: number;
  readonly createWorker?: () => LoadWorker;
  /** E2E build only: the worker never answers. */
  readonly hang?: boolean;
  /** Stops the read: the worker is killed and the load rejects with the signal's reason (an `AbortError`). */
  readonly signal?: AbortSignal;
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException('The model read was aborted.', 'AbortError');
}

function startWorker(): LoadWorker {
  return new Worker(new URL('./loadWorker.ts', import.meta.url), { type: 'module' });
}

// Parses in a worker: the loaders are synchronous, so a hostile file could hang the tab. The worker is killed after
// `timeoutMs` or on abort, which is the only reliable stop; every load gets a fresh one.
export function loadModel(request: LoadRequest, options: LoadOptions = {}): Promise<LoadedModel> {
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
  const { signal } = options;
  return new Promise<LoadedModel>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    let worker: LoadWorker;
    try {
      worker = (options.createWorker ?? startWorker)();
    } catch (error) {
      reject(new IntakeError('LOAD_FAILED', `The model reader could not start: ${String(error)}`));
      return;
    }
    let done = false;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      worker.terminate();
      settle();
    };
    const aborted = (): void => finish(() => reject(abortReason(signal)));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new IntakeError(
              'LOAD_TIMEOUT',
              `Reading the file took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`,
            ),
          ),
        ),
      timeoutMs,
    );
    worker.addEventListener('message', (event) => {
      const reply = event.data;
      finish(() => {
        if (reply.ok) resolve(reply);
        else reject(new IntakeError(reply.code, reply.message));
      });
    });
    const crashed = (): void =>
      finish(() => reject(new IntakeError('LOAD_FAILED', 'The model reader stopped working.')));
    worker.addEventListener('error', crashed);
    worker.addEventListener('messageerror', crashed);
    signal?.addEventListener('abort', aborted, { once: true });
    worker.postMessage({ request, arms: options.arms ?? 'classic', ...(options.hang ? { hang: true } : {}) });
  });
}
