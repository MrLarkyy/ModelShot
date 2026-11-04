import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The package index pulls in GLSL and the preset files through Vite's ?raw, which Playwright cannot load: the parser
// directly, on the same files.
import type { LookDomeEnvironment, LookPreset } from '../../../packages/looks/src/LookPreset';
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

/** The shipped presets lit by a dome: their environment has sky and ground, which tests edit. */
export type DomeLookId = 'studio' | 'marketplace' | 'rim';

/** A look preset whose environment is a dome. */
export type DomeLookPreset = LookPreset & { readonly environment: LookDomeEnvironment };

/**
 * A shipped look preset (`LOOK_PRESETS[id]` of @modelshot/looks), read from its file for the Node side of the tests;
 * a dome preset's id types it as one (and is checked to be one).
 */
export function lookPresetFile(id: DomeLookId): DomeLookPreset;
export function lookPresetFile(id: string): LookPreset;
export function lookPresetFile(id: string): LookPreset {
  if (!/^[a-z0-9-]{1,32}$/.test(id)) throw new Error(`not a preset id: ${id}`);
  const look = parseLookPreset(readFileSync(join(PRESET_DIR, `${id}.json`), 'utf8'));
  const dome: readonly string[] = ['studio', 'marketplace', 'rim'] satisfies DomeLookId[];
  if (dome.includes(id) && look.environment.kind !== 'dome') throw new Error(`preset ${id} is not lit by a dome`);
  return look;
}
