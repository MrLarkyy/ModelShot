import { normaliseReference } from './normaliseReference';

/** References as written, in order, each relative path once; full after `maxReferences + 1`. */
export class ReferenceList {
  readonly references: string[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly maxReferences: number) {}

  get full(): boolean {
    return this.references.length > this.maxReferences;
  }

  add(reference: string): void {
    if (reference === '' || this.full) return;
    const path = normaliseReference(reference);
    if (this.seen.has(path)) return;
    this.seen.add(path);
    this.references.push(reference);
  }
}
