// The keys to delete so that at most `max` entries remain, the oldest `savedAt` first.
export function keysToEvict(
  entries: readonly { readonly key: string; readonly savedAt: number }[],
  max: number,
): string[] {
  if (entries.length <= max) return [];
  return [...entries]
    .sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key))
    .slice(0, entries.length - max)
    .map((entry) => entry.key);
}
