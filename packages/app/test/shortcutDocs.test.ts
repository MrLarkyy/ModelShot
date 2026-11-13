import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ORBIT_KEYS } from '../src/shortcuts/orbitKeys';
import { SHORTCUTS } from '../src/shortcuts/shortcutAction';
import { SCRUBBER_KEYS } from '../src/timeline/scrubberKeyList';

// The Shortcuts table of docs/app.md: one row per entry, in the order of the lists the app is built from.
async function docRows(): Promise<[string, string][]> {
  const text = await readFile(new URL('../../../docs/app.md', import.meta.url), 'utf8');
  const start = text.indexOf('\n## Shortcuts');
  const end = text.indexOf('\n## ', start + 1);
  return text
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 2 && cells[0] !== 'Key' && !/^-+$/.test(cells[0] ?? ''))
    .map(([keys, label]) => [keys ?? '', label ?? '']);
}

describe('docs/app.md shortcuts', () => {
  it('has one row per shortcut, with its keys and label, then the 3D view and scrubber keys', async () => {
    const expected: [string, string][] = [
      ...SHORTCUTS.map((s): [string, string] => [s.keys, s.label]),
      ...ORBIT_KEYS.map((s): [string, string] => [s.keys, s.label]),
      ...SCRUBBER_KEYS.map((s): [string, string] => [s.keys, s.label]),
    ];
    expect(await docRows()).toEqual(expected);
  });
});
