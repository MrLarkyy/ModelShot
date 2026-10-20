import { quoteValue } from '../text/quoteValue';
import type { ObjWarningList } from './ObjWarning';

/** Distinct keywords tracked by name; lines with any further keyword are only counted, so memory stays bounded. */
export const MAX_TRACKED_KEYWORDS = 64;

/** Counts the lines of unsupported keywords for one warning per keyword, with its count and first line. */
export class KeywordTally {
  private readonly keywords = new Map<string, { count: number; path: string }>();
  private otherLines = 0;
  private otherPath = '';

  add(keyword: string, path: string): void {
    const key = keyword.slice(0, 32);
    const seen = this.keywords.get(key);
    if (seen) seen.count++;
    else if (this.keywords.size < MAX_TRACKED_KEYWORDS) this.keywords.set(key, { count: 1, path });
    else {
      if (this.otherLines === 0) this.otherPath = path;
      this.otherLines++;
    }
  }

  /** One `UNSUPPORTED_STATEMENT` per tracked keyword, then one for all the others; `verb` ends each message. */
  report(warnings: ObjWarningList, verb: string): void {
    for (const [keyword, { count, path }] of this.keywords) {
      warnings.add('UNSUPPORTED_STATEMENT', path, `${quoteValue(keyword)} (${lines(count)}) ${verb}`);
    }
    if (this.otherLines > 0) {
      warnings.add(
        'UNSUPPORTED_STATEMENT',
        this.otherPath,
        `${lines(this.otherLines)} with keywords beyond the first ${MAX_TRACKED_KEYWORDS} distinct ones ${verb}`,
      );
    }
  }
}

function lines(count: number): string {
  return `${count} line${count === 1 ? '' : 's'}`;
}
