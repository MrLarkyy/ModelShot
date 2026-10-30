import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ListMessage, ListReply, LoadMessage, LoadReply } from '../src/intake/LoadMessages';
import { sha256Hex } from '../src/intake/sha256Hex';

type Reply = LoadReply | ListReply;

/** The worker's global scope: the message listener it adds, and what it posts back. */
const scope = vi.hoisted(() => ({
  listener: null as ((event: MessageEvent<LoadMessage | ListMessage>) => void) | null,
  replies: [] as unknown[],
}));

beforeAll(async () => {
  vi.stubGlobal('self', {
    addEventListener: (_type: string, listener: (event: MessageEvent<LoadMessage | ListMessage>) => void) => {
      scope.listener = listener;
    },
    postMessage: (reply: unknown) => scope.replies.push(reply),
  });
  await import('../src/intake/loadWorker');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function ask(message: LoadMessage | ListMessage): Promise<Reply> {
  const before = scope.replies.length;
  scope.listener?.({ data: message } as MessageEvent<LoadMessage | ListMessage>);
  await vi.waitFor(() => expect(scope.replies.length).toBeGreaterThan(before));
  return scope.replies[before] as Reply;
}

const LAST_MODIFIED = 1_700_000_000_000;
/** Two different models with the same name, size and date: only the session can tell them apart. */
const gltf = (generator: string): File =>
  new File([JSON.stringify({ asset: { version: '2.0', generator } })], 'a.gltf', {
    lastModified: LAST_MODIFIED,
  });
const keyOf = async (file: File): Promise<string> => sha256Hex(new Uint8Array(await file.arrayBuffer()));
const list = (file: File): ListMessage => ({ list: { file, of: 'model', maxReferences: 512 } });
const load = (model: File, listed: boolean): LoadMessage => ({
  request: { kind: 'model', model, resources: [] },
  arms: 'classic',
  ...(listed ? { listed: true } : {}),
});

describe('loadWorker', () => {
  it('loads a listed model from what its list parsed: one JSON parse for both', async () => {
    const model = gltf('aaaa');
    const parse = vi.spyOn(JSON, 'parse');
    expect(await ask(list(model))).toEqual({ ok: true, references: [] });
    const reply = await ask(load(new File([model], model.name, { lastModified: LAST_MODIFIED }), true));
    expect(reply).toMatchObject({ ok: true, name: 'a.gltf', key: await keyOf(model) });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('reads the model again for a load not marked listed, never the kept one', async () => {
    const listed = gltf('aaaa');
    const other = gltf('bbbb');
    expect([listed.name, listed.size, listed.lastModified]).toEqual([other.name, other.size, other.lastModified]);
    await ask(list(listed));
    const parse = vi.spyOn(JSON, 'parse');
    const reply = await ask(load(other, false));
    expect(reply).toMatchObject({ ok: true, key: await keyOf(other) });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('drops the kept model after a load: a later load marked listed reads its own file', async () => {
    const first = gltf('aaaa');
    await ask(list(first));
    await ask(load(first, true));
    const second = gltf('bbbb');
    const reply = await ask(load(second, true));
    expect(reply).toMatchObject({ ok: true, key: await keyOf(second) });
  });
});
