import { HandoffLimits } from './HandoffLimits';

// Storing a handoff copies every byte into the browser's blob store, so its timeout grows with the selection. Measured
// in Chromium for the limit (32 files, 256 MiB): put 45..274 ms (Windows SSD, Ubuntu container), take 174..433 ms.
// The floor assumes a disk about 50 times slower than that; at the limit the write gets 5 s + 16 s = 21 s, and a
// stuck database is still given up on. Taking the record reads no file bytes, so the app keeps the fixed 5 s.
export const PUT_MIN_BYTES_PER_SECOND = 16 * 1024 * 1024;

export function putTimeoutMs(totalBytes: number): number {
  return HandoffLimits.storageTimeoutMs + Math.ceil((totalBytes / PUT_MIN_BYTES_PER_SECOND) * 1000);
}
