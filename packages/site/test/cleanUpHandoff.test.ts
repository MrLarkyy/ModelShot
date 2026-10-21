import { describe, expect, it, vi } from 'vitest';
import { cleanUpHandoff } from '../src/cleanUpHandoff';

function factory(databases: IDBDatabaseInfo[] | undefined): { factory: IDBFactory; open: ReturnType<typeof vi.fn> } {
  const open = vi.fn(() => {
    const request: { onerror?: () => void; error: Error } = { error: new Error('test database') };
    queueMicrotask(() => request.onerror?.());
    return request;
  });
  const fake = databases === undefined ? { open } : { open, databases: () => Promise.resolve(databases) };
  return { factory: fake as unknown as IDBFactory, open };
}

describe('cleanUpHandoff', () => {
  it('does not open (and so create) the database when it does not exist', async () => {
    const { factory: fake, open } = factory([{ name: 'other', version: 1 }]);
    await cleanUpHandoff(fake);
    expect(open).not.toHaveBeenCalled();
  });

  it('skips the cleanup where indexedDB.databases() is missing', async () => {
    const { factory: fake, open } = factory(undefined);
    await cleanUpHandoff(fake);
    expect(open).not.toHaveBeenCalled();
  });

  it('skips the cleanup without IndexedDB', async () => {
    await expect(cleanUpHandoff(undefined)).resolves.toBeUndefined();
  });

  it('opens the existing handoff database to discard a stale record', async () => {
    const { factory: fake, open } = factory([{ name: 'modelshot-handoff', version: 1 }]);
    await expect(cleanUpHandoff(fake)).rejects.toThrow(/test database/);
    expect(open).toHaveBeenCalledWith('modelshot-handoff', 1);
  });
});
