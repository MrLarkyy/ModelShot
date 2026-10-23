import {
  BbmodelError,
  GltfError,
  ObjError,
  SkinError,
  createPlayerModel,
  detectModelFormat,
  loadBbmodel,
  loadGltf,
  loadObj,
  loadSkin,
} from '@modelshot/formats';
import type { SceneDocument } from '@modelshot/scene';
import type { LoadedModel, LoadMessage, LoadReply } from './LoadMessages';
import { collectTransferables } from './collectTransferables';

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function read(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.arrayBuffer());
}

async function load(message: LoadMessage): Promise<LoadedModel> {
  const { request, arms } = message;
  if (request.kind === 'skin') {
    const bytes = await read(request.skin);
    const doc = createPlayerModel(loadSkin(bytes, { name: request.skin.name }), { arms });
    return { doc, warnings: [], name: request.skin.name, kind: 'skin', key: await sha256Hex(bytes) };
  }
  const bytes = await read(request.model);
  const format = detectModelFormat(request.model.name, bytes.subarray(0, 4));
  const files = new Map<string, Uint8Array>();
  for (const resource of request.resources) files.set(resource.name, await read(resource));
  let doc: SceneDocument;
  let warnings: readonly { readonly message: string }[];
  if (format === 'bbmodel') ({ scene: doc, warnings } = loadBbmodel(bytes, { textureFiles: files }));
  else if (format === 'gltf' || format === 'glb') ({ scene: doc, warnings } = loadGltf(bytes, { files }));
  else if (format === 'obj') ({ scene: doc, warnings } = loadObj(bytes, { files, fileName: request.model.name }));
  else throw new SkinError('NOT_PNG', 'not a model file');
  return {
    doc,
    warnings: warnings.map((warning) => warning.message),
    name: request.model.name,
    kind: 'model',
    key: await sha256Hex(bytes),
  };
}

function failure(error: unknown): LoadReply {
  if (error instanceof BbmodelError || error instanceof GltfError || error instanceof ObjError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof SkinError) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: 'LOAD_FAILED', message: error instanceof Error ? error.message : String(error) };
}

self.addEventListener('message', (event: MessageEvent<LoadMessage>) => {
  void (async () => {
    // Test hook: a loader that never returns, for the watchdog. Not in the production build.
    if (import.meta.env.MODE === 'e2e' && event.data.hang)
      for (;;) {
        // never returns
      }
    try {
      const loaded = await load(event.data);
      const reply: LoadReply = { ok: true, ...loaded };
      self.postMessage(reply, { transfer: collectTransferables(loaded.doc) });
    } catch (error) {
      self.postMessage(failure(error));
    }
  })();
});
