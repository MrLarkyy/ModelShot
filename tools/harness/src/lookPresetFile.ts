import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The package index pulls in GLSL and the preset files through Vite's ?raw, which Playwright cannot load: the parser
// directly, on the same files.
import type { LookPreset } from '../../../packages/looks/src/LookPreset';
import { parseLookPreset } from '../../../packages/looks/src/parseLookPreset';

const PRESET_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'looks',
  'src',
  'presets',
);

/** A shipped look preset (`LOOK_PRESETS[id]` of @modelshot/looks), read from its file for the Node side of the tests. */
export function lookPresetFile(id: string): LookPreset {
  if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error(`not a preset id: ${id}`);
  return parseLookPreset(readFileSync(join(PRESET_DIR, `${id}.json`), 'utf8'));
}
