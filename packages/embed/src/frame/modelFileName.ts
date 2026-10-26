const MAX_NAME_CHARS = 128;
const FALLBACK_NAME = 'model';

/**
 * The file name of a model URL: its last path segment, decoded, at most 128 characters, so the intake checks and the
 * loader see its extension as for a picked file.
 */
export function modelFileName(url: string): string {
  const segment = new URL(url).pathname.split('/').pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // A malformed escape: the raw segment still carries the extension.
  }
  name = name.replaceAll(/[/\\]/g, '_');
  // Keep the end, where the extension is.
  if (name.length > MAX_NAME_CHARS) name = name.slice(name.length - MAX_NAME_CHARS);
  return name === '' ? FALLBACK_NAME : name;
}
