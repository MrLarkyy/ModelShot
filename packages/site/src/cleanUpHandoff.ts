import { discardStaleHandoff, HANDOFF_DB } from '@modelshot/app/handoff';

// Opening the handoff database would create it, so the cleanup runs only where it already exists: a visitor who never
// handed a file over gets no database. A browser without indexedDB.databases() skips the cleanup; a leftover record
// there stays until the next handoff replaces it or the app takes it.
export async function cleanUpHandoff(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<void> {
  if (typeof factory?.databases !== 'function') return;
  const databases = await factory.databases();
  if (databases.some((database) => database.name === HANDOFF_DB)) await discardStaleHandoff({ factory });
}
