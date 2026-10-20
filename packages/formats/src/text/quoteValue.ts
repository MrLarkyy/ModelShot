/** At most this many characters of file content appear in an error or warning message. */
export const MAX_QUOTED_CHARS = 32;

/** Short, safe rendering of a value from the file for messages: never more than `MAX_QUOTED_CHARS` of its content. */
export function quoteValue(value: unknown): string {
  if (typeof value === 'string') {
    const cut = value.length > MAX_QUOTED_CHARS;
    return JSON.stringify(cut ? value.slice(0, MAX_QUOTED_CHARS) : value) + (cut ? '…' : '');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  return Array.isArray(value) ? 'an array' : 'an object';
}

const MAX_PATH_IN_MESSAGE = 80;

/** Keeps the start and the end of a deep JSON path so a message stays short. */
export function shortenPath(path: string): string {
  if (path.length <= MAX_PATH_IN_MESSAGE) return path;
  return `${path.slice(0, 30)}…${path.slice(path.length - (MAX_PATH_IN_MESSAGE - 31))}`;
}
