import type { LoadedModel } from './LoadMessages';
import type { LoadRequest } from './groupFiles';
import { openModel, type LoadOptions } from './openModel';

export { LOAD_TIMEOUT_MS, type LoadOptions, type LoadWorker } from './openModel';

/** Reads one model or skin in a fresh worker: a session with nothing listed before its load (see `openModel`). */
export function loadModel(request: LoadRequest, options: LoadOptions = {}): Promise<LoadedModel> {
  return openModel(options).load(request);
}
