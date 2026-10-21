// Limits of the landing page -> app file handoff (docs/site.md). Checked before anything is stored and again
// when the app reads the record, because the record in IndexedDB is untrusted.
export const HandoffLimits = {
  maxFiles: 32,
  maxTotalBytes: 256 * 1024 * 1024,
  maxAgeMs: 10 * 60 * 1000,
  storageTimeoutMs: 5000,
  extensions: ['.bbmodel', '.gltf', '.glb', '.bin', '.obj', '.mtl', '.png'],
} as const;

export type HandoffLimits = typeof HandoffLimits;
