/**
 * A reference with a URL scheme (`http:`, `https:`, `file:`, `data:`, …) or starting with `//` or `\\`: never a file
 * next to the model. A drive letter (`C:`) is a path.
 */
export function isUrlReference(reference: string): boolean {
  // A scheme has two or more letters: `C:\models\a.png` is a drive path, looked up by its base name like any other.
  return /^[a-z][a-z0-9+.-]+:/i.test(reference) || reference.startsWith('//') || reference.startsWith('\\\\');
}

/** A relative reference as a path: percent-decoded (a malformed escape kept as is), then as `normalisePath`. */
export function normaliseReference(reference: string): string {
  return normalisePath(percentDecode(reference));
}

/** Backslashes as slashes, every leading `./` dropped. */
export function normalisePath(path: string): string {
  let normalised = path.replace(/\\/g, '/');
  while (normalised.startsWith('./')) normalised = normalised.slice(2);
  return normalised;
}

/** The last segment of a normalised path. */
export function referenceBaseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function percentDecode(reference: string): string {
  try {
    return decodeURIComponent(reference);
  } catch {
    return reference;
  }
}
