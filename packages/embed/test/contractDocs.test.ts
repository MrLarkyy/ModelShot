import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMBED_ERROR_CODES } from '../src/EmbedError';
import { ELEMENT_ATTRIBUTE_NAMES, EMBED_PARAM_NAMES } from '../src/EmbedParams';

const DOC = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'embed.md'), 'utf8');

/** The backticked names in the first column of the table under the `## <heading>` section of docs/embed.md. */
function tableNames(heading: string): string[] {
  const start = DOC.indexOf(`\n## ${heading}\n`);
  expect(start, `docs/embed.md has a "## ${heading}" section`).toBeGreaterThanOrEqual(0);
  const end = DOC.indexOf('\n## ', start + 1);
  const section = DOC.slice(start, end < 0 ? undefined : end);
  return section
    .split('\n')
    .map((line) => /^\|\s*`([^`]+)`\s*\|/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

// docs/embed.md is the public contract: its tables list exactly what the code reads and reports, nothing more or less.
describe('docs/embed.md matches the code', () => {
  it('lists every fragment parameter', () => {
    expect(tableNames('Frame parameters').sort()).toEqual([...EMBED_PARAM_NAMES].sort());
  });

  it('lists every element attribute', () => {
    expect(tableNames('Element attributes').sort()).toEqual([...ELEMENT_ATTRIBUTE_NAMES].sort());
  });

  it("lists every one of the embed's error codes", () => {
    expect(tableNames('Errors').sort()).toEqual([...EMBED_ERROR_CODES].sort());
  });
});
