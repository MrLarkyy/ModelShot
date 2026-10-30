export interface ReferenceListOptions {
  /** The list stops after `maxReferences + 1` entries, so a caller can tell "too many" without a longer scan. */
  readonly maxReferences: number;
}
