import { EmbedError } from '../EmbedError';

export const PROBE_TIMEOUT_MS = 10_000;

export interface ExplainOptions {
  readonly fetch: typeof fetch;
  /** The origin the model was requested from: the frame page's. */
  readonly frameOrigin: string;
  readonly timeoutMs?: number;
}

/**
 * Why a model request failed without a response. The browser hides whether the server refused the CORS check or was
 * never reached, so one HEAD request in no-cors mode (no credentials, no referrer, same URL) tells them apart: an
 * answer means the server is there and withholds the header (`MODEL_CORS_BLOCKED`), none means `MODEL_UNREACHABLE`.
 */
export async function explainFetchFailure(url: string, options: ExplainOptions): Promise<EmbedError> {
  const modelOrigin = new URL(url).origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_TIMEOUT_MS);
  try {
    await options.fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    return new EmbedError(
      'MODEL_CORS_BLOCKED',
      `${modelOrigin} answered but does not let ${options.frameOrigin} read the file: its server must send ` +
        `Access-Control-Allow-Origin: * (or ${options.frameOrigin}) for GET requests of the model.`,
    );
  } catch {
    return new EmbedError(
      'MODEL_UNREACHABLE',
      `${modelOrigin} could not be reached: the browser is offline, the address is wrong or the server refused the connection.`,
    );
  } finally {
    clearTimeout(timer);
  }
}
