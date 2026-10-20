export type DataUriResult =
  | { readonly ok: true; readonly mimeType: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly reason: 'TOO_LONG' | 'NOT_BASE64_DATA_URI' | 'BAD_BASE64' };

const HEADER = /^data:([a-z0-9.+-]{1,64}\/[a-z0-9.+-]{1,64});base64,/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decodes a `data:<mime>;base64,` URI. The length is checked before anything is decoded or allocated, and the payload
 * alphabet before `atob`, which would otherwise skip whitespace and accept unpadded input.
 */
export function decodeDataUri(uri: string, maxChars: number): DataUriResult {
  if (uri.length > maxChars) return { ok: false, reason: 'TOO_LONG' };
  const header = HEADER.exec(uri);
  if (!header?.[1]) return { ok: false, reason: 'NOT_BASE64_DATA_URI' };
  const payload = uri.slice(header[0].length);
  if (payload.length % 4 !== 0 || !BASE64.test(payload)) return { ok: false, reason: 'BAD_BASE64' };
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, mimeType: header[1].toLowerCase(), bytes };
}
