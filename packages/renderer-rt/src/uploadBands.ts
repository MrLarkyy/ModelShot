/** Bytes one `texSubImage2D` of baked light may carry: small enough for the transfer buffer to take it at once. */
export const UPLOAD_BAND_BYTES = 256 * 1024;
/** Bytes of baked light uploaded per `render()` (or `advanceLighting()`) call. */
export const UPLOAD_FRAME_BYTES = 1024 * 1024;

/** Rows `[row, count]` of one texSubImage2D each. */
export type UploadBand = readonly [number, number];

/**
 * The next bands of an upload of `rows` rows of `rowBytes` each that starts at `from`: whole rows, at most
 * `bandBytes` per band (at least one row) and `frameBytes` in all (at least one band). A large upload through one
 * texSubImage2D makes the browser wait for its GPU process to consume the earlier chunks, while that process also runs
 * the bake's draws; bands spread over frames never wait for more than the space they need.
 */
export function uploadBands(
  rows: number,
  rowBytes: number,
  from: number,
  bandBytes = UPLOAD_BAND_BYTES,
  frameBytes = UPLOAD_FRAME_BYTES,
): UploadBand[] {
  const perBand = Math.max(1, Math.floor(bandBytes / Math.max(1, rowBytes)));
  const bands: UploadBand[] = [];
  let row = from;
  let bytes = 0;
  while (row < rows && (bands.length === 0 || bytes + Math.min(perBand, rows - row) * rowBytes <= frameBytes)) {
    const count = Math.min(perBand, rows - row);
    bands.push([row, count]);
    row += count;
    bytes += count * rowBytes;
  }
  return bands;
}
