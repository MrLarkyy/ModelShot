import { ExportError } from './ExportError';
import { MAX_OUTPUT_BYTES } from './exportLimits';

/** The encoded pieces of a file, counted against `MAX_OUTPUT_BYTES` as they come in. */
export class OutputParts {
  private readonly parts: Uint8Array<ArrayBuffer>[] = [];
  private bytes = 0;

  constructor(private readonly limit = MAX_OUTPUT_BYTES) {}

  get size(): number {
    return this.bytes;
  }

  /** Adds `part`; past the limit throws `ExportError` `LIMIT_EXCEEDED` and keeps nothing more. */
  push(part: Uint8Array<ArrayBuffer>): void {
    this.reserve(part.length);
    this.parts.push(part);
    this.bytes += part.length;
  }

  /** Throws `LIMIT_EXCEEDED` when `extra` more bytes would pass the limit. */
  reserve(extra: number): void {
    if (this.bytes + extra > this.limit) {
      throw new ExportError('LIMIT_EXCEEDED', `the encoded file would pass the limit of ${this.limit} bytes`, 'frames');
    }
  }

  blob(type: string): Blob {
    return new Blob(this.parts, { type });
  }

  clear(): void {
    this.parts.length = 0;
    this.bytes = 0;
  }
}
