/**
 * References as written, in order, each distinct spelling once; full after `maxReferences + 1`. Spellings of one path
 * (`a.bin`, `./a.bin`, `%61.bin`) all stay: a caller checking the references must see each one, and dedupes the files
 * itself.
 */
export class ReferenceList {
  readonly references: string[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly maxReferences: number) {}

  get full(): boolean {
    return this.references.length > this.maxReferences;
  }

  add(reference: string): void {
    if (reference === '' || this.full || this.seen.has(reference)) return;
    this.seen.add(reference);
    this.references.push(reference);
  }
}
