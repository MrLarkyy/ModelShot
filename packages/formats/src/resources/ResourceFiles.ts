export type ResourceResult =
  | { readonly ok: true; readonly fileName: string; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      /** `NOT_FETCHED`: a URL (scheme or `//`), never fetched; `NOT_PICKED`: no picked file has that name. */
      readonly reason: 'NOT_FETCHED' | 'NOT_PICKED';
      /** The file the user should pick (base name), `''` for a URL. */
      readonly wanted: string;
    };

/**
 * Files the user picked next to a model, looked up by the relative references inside it (glTF `uri`, OBJ `mtllib`,
 * MTL `map_Kd`). Nothing outside the map is ever read or fetched.
 */
export class ResourceFiles {
  private readonly byPath = new Map<string, string>();
  private readonly byBaseName = new Map<string, string>();
  private readonly files: ReadonlyMap<string, Uint8Array>;

  constructor(files: ReadonlyMap<string, Uint8Array> | undefined) {
    this.files = files ?? new Map<string, Uint8Array>();
    for (const name of this.files.keys()) {
      const path = normalisePath(name);
      if (!this.byPath.has(path)) this.byPath.set(path, name);
      const base = baseName(path).toLowerCase();
      if (!this.byBaseName.has(base)) this.byBaseName.set(base, name);
    }
  }

  /**
   * The picked file for `reference`: percent-decoded, backslashes as slashes, leading `./` dropped; the exact relative
   * path first, then the case-insensitive base name. A reference with a URL scheme (`http:`, `https:`, `file:`, …) or
   * starting with `//` is never resolved; a drive letter (`C:`) is a path.
   */
  resolve(reference: string): ResourceResult {
    // A scheme has two or more letters: `C:\models\a.png` is a drive path, looked up by its base name like any other.
    if (/^[a-z][a-z0-9+.-]+:/i.test(reference) || reference.startsWith('//') || reference.startsWith('\\\\')) {
      return { ok: false, reason: 'NOT_FETCHED', wanted: '' };
    }
    const path = normalisePath(percentDecode(reference));
    const base = baseName(path);
    const name = this.byPath.get(path) ?? this.byBaseName.get(base.toLowerCase());
    const bytes = name === undefined ? undefined : this.files.get(name);
    if (name === undefined || bytes === undefined) return { ok: false, reason: 'NOT_PICKED', wanted: base };
    return { ok: true, fileName: name, bytes };
  }
}

function percentDecode(reference: string): string {
  try {
    return decodeURIComponent(reference);
  } catch {
    return reference;
  }
}

function normalisePath(path: string): string {
  let normalised = path.replace(/\\/g, '/');
  while (normalised.startsWith('./')) normalised = normalised.slice(2);
  return normalised;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
