import { ExportError } from './ExportError';
import type { ClipFormat, ExportWarning } from './ExportOptions';

/** Per format: whether this browser can encode it, and if not, why (a phrase for the warning). */
export type FormatAvailability = Readonly<
  Record<ClipFormat, { readonly available: boolean; readonly reason?: string }>
>;

/** The format to encode in and a `FORMAT_FALLBACK` warning when it is not the one asked for. */
export interface FormatSelection {
  readonly format: ClipFormat;
  readonly warnings: readonly ExportWarning[];
}

/** What a format falls back to, in order. APNG and GIF are our own code and always available. */
export const FORMAT_FALLBACKS: Readonly<Record<ClipFormat, readonly ClipFormat[]>> = {
  mp4: ['mp4', 'webm', 'apng'],
  webm: ['webm', 'apng'],
  webp: ['webp', 'apng'],
  apng: ['apng'],
  gif: ['gif'],
};

export const FORMAT_NAMES: Readonly<Record<ClipFormat, string>> = {
  mp4: 'MP4',
  webm: 'WebM',
  webp: 'animated WebP',
  apng: 'APNG',
  gif: 'GIF',
};

/**
 * The first available format of `requested`'s fallback chain (`FORMAT_FALLBACKS`). Another than `requested` comes
 * with a warning naming both and why; none available throws `ExportError` `UNSUPPORTED_FORMAT`.
 */
export function selectFormat(requested: ClipFormat, availability: FormatAvailability): FormatSelection {
  const chain = FORMAT_FALLBACKS[requested];
  const used = chain.find((format) => availability[format].available);
  const why = availability[requested].reason ?? 'this browser cannot encode it';
  if (!used) {
    throw new ExportError(
      'UNSUPPORTED_FORMAT',
      `${FORMAT_NAMES[requested]} cannot be exported here (${why}), nor any format it falls back to`,
      'format',
    );
  }
  if (used === requested) return { format: used, warnings: [] };
  return {
    format: used,
    warnings: [
      {
        code: 'FORMAT_FALLBACK',
        requested,
        used,
        message: `${FORMAT_NAMES[requested]} cannot be exported here (${why}), so the clip was exported as ${FORMAT_NAMES[used]} instead.`,
      },
    ],
  };
}
