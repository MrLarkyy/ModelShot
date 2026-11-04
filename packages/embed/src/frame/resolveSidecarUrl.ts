import { normalisePath, normaliseReference, referenceBaseName } from '@modelshot/formats';
import { EmbedError } from '../EmbedError';
import { MAX_MODEL_URL_CHARS } from '../EmbedParams';
import { MODEL_SIDECARS, type SidecarPolicy } from './SidecarPolicy';

/**
 * What to do with one file a model refers to: download `href` as a file called `name` (the name the loader looks the
 * reference up by), leave it to the loader as a file that cannot be picked (`skip`), or refuse the model (`refuse`).
 */
export type SidecarUrl =
  | { readonly kind: 'download'; readonly href: string; readonly name: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'refuse'; readonly error: EmbedError };

const MAX_SHOWN_CHARS = 80;

/** What the URL parser drops before reading a URL: leading and trailing C0 controls and spaces, tabs and newlines. */
function asParsed(reference: string): string {
  let start = 0;
  let end = reference.length;
  while (start < end && reference.charCodeAt(start) <= 0x20) start++;
  while (end > start && reference.charCodeAt(end - 1) <= 0x20) end--;
  return reference.slice(start, end).replace(/[\t\n\r]/g, '');
}

function shown(reference: string): string {
  const cut = reference.length > MAX_SHOWN_CHARS ? `${reference.slice(0, MAX_SHOWN_CHARS - 1)}…` : reference;
  return JSON.stringify(cut);
}

/**
 * Resolves a reference of a model at `baseUrl` (the model's URL, or for an OBJ texture its MTL's) under the embed's
 * policy: only a relative path, landing on `modelOrigin` over http(s), at most 2048 characters, is downloaded. A
 * scheme (`data:`, `javascript:`, `file:`, even a same-origin `https:`), a protocol-relative or backslash authority, or
 * anything the URL parser lands elsewhere is refused before any request. A drive path (`C:\tex\a.png`) is skipped: it
 * names a file of the author's machine, never requested. A file the model's loader does not take next to it
 * (`policy.extensions`: for glTF and OBJ `.bin`, `.png`, `.jpg`, `.jpeg` or `.mtl`, for a `.bbmodel` `.png`) is
 * skipped: the loader reports it missing, as for a local open. So is a reference whose URL has a query or fragment
 * (`a?b.png`, `tex#1.png`): it would download another URL than the file name the loader looks it up by. The file is
 * named as the loader looks the reference up: its base name, percent-decoded unless `policy.decodedName` is false.
 */
export function resolveSidecarUrl(
  reference: string,
  baseUrl: string,
  modelOrigin: string,
  policy: SidecarPolicy = MODEL_SIDECARS,
): SidecarUrl {
  const refuse = (why: string): SidecarUrl => ({
    kind: 'refuse',
    error: new EmbedError(
      'SIDECAR_REFUSED',
      `The model refers to ${shown(reference)}, which the embed does not download: ${why} ` +
        `Refer to the file by a path relative to the model on its own server.`,
    ),
  });
  if (reference.length > MAX_MODEL_URL_CHARS) return refuse(`it is longer than ${MAX_MODEL_URL_CHARS} characters.`);
  const parsed = asParsed(reference);
  if (/^[a-z]:[/\\]/i.test(parsed)) return { kind: 'skip' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(parsed)) return refuse('it is a URL, not a relative path.');
  if (/^[/\\]{2}/.test(parsed)) return refuse('it names another server.');
  let url: URL;
  try {
    url = new URL(reference, baseUrl);
  } catch {
    return refuse('it is not a valid path.');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== modelOrigin) {
    return refuse(`it leads off the model's server ${modelOrigin}.`);
  }
  if (url.href.length > MAX_MODEL_URL_CHARS) return refuse(`its URL is longer than ${MAX_MODEL_URL_CHARS} characters.`);
  if (url.search !== '' || url.hash !== '') return { kind: 'skip' };
  const name = referenceBaseName(policy.decodedName ? normaliseReference(reference) : normalisePath(reference));
  const lower = name.toLowerCase();
  if (!policy.extensions.some((extension) => lower.endsWith(extension))) return { kind: 'skip' };
  return { kind: 'download', href: url.href, name };
}
