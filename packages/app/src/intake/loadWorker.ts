import {
  BbmodelError,
  GltfError,
  ObjError,
  SkinError,
  createPlayerModel,
  listMtlReferences,
  loadSkin,
} from '@modelshot/formats';
import type { ListMessage, ListReply, LoadedModel, LoadFailure, LoadMessage, LoadReply } from './LoadMessages';
import { ModelSource } from './ModelSource';
import { collectTransferables } from './collectTransferables';
import { sha256Hex } from './sha256Hex';

async function read(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.arrayBuffer());
}

/** The model a list read, kept for its load: the file is read and parsed once. */
let source: ModelSource | null = null;

async function list({ list: { file, of, maxReferences } }: ListMessage): Promise<string[]> {
  if (of === 'library') return listMtlReferences(await read(file), { maxReferences });
  source = await ModelSource.open(file);
  return source.references(maxReferences);
}

async function load(message: LoadMessage): Promise<LoadedModel> {
  const { request, arms } = message;
  if (request.kind === 'skin') {
    const bytes = await read(request.skin);
    const doc = createPlayerModel(loadSkin(bytes, { name: request.skin.name }), { arms });
    return { doc, warnings: [], name: request.skin.name, kind: 'skin', key: await sha256Hex(bytes) };
  }
  // Only the session knows the File is the one listed: a copy here cannot tell it from another file of that name.
  const kept = message.listed ? source : null;
  source = null;
  const model = kept ?? (await ModelSource.open(request.model));
  return model.load(request.resources);
}

function failure(error: unknown): LoadFailure {
  if (error instanceof BbmodelError || error instanceof GltfError || error instanceof ObjError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof SkinError) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: 'LOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
}

self.addEventListener('message', (event: MessageEvent<LoadMessage | ListMessage>) => {
  void (async () => {
    const message = event.data;
    if ('list' in message) {
      try {
        const reply: ListReply = { ok: true, references: await list(message) };
        self.postMessage(reply);
      } catch (error) {
        self.postMessage(failure(error));
      }
      return;
    }
    // Test hook: a loader that never returns, for the watchdog. Not in the production build.
    if (import.meta.env.MODE === 'e2e' && message.hang)
      for (;;) {
        // never returns
      }
    try {
      const loaded = await load(message);
      const reply: LoadReply = { ok: true, ...loaded };
      self.postMessage(reply, { transfer: collectTransferables(loaded.doc) });
    } catch (error) {
      self.postMessage(failure(error));
    }
  })();
});
