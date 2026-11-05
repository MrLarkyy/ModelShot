/** Limits `decodeRadianceHdr` checks before it allocates or decodes anything they bound. */
export interface HdrLimits {
  /** Size of the file in bytes. */
  readonly maxBytes: number;
  /** Bytes of the header up to and including its blank line. */
  readonly maxHeaderBytes: number;
  /** Width of the image in pixels. */
  readonly maxWidth: number;
  /** Width × height. */
  readonly maxPixels: number;
  /** Largest scene-linear value of a decoded channel. */
  readonly maxRadiance: number;
}

export const DEFAULT_HDR_LIMITS: HdrLimits = Object.freeze({
  maxBytes: 32 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  maxWidth: 8192,
  maxPixels: 4 * 1024 * 1024,
  maxRadiance: 1e6,
});
