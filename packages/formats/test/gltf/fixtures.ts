import externalBinUri from '../fixtures/gltf/external.bin?inline';
import externalPngUri from '../fixtures/gltf/external.png?inline';
import { fromBase64 } from './gltfBuilder';

const sources = import.meta.glob<string>('../fixtures/gltf/*.gltf', { query: '?raw', import: 'default', eager: true });

export const GLTF_FIXTURE_NAMES = ['scene-nodes', 'external'] as const;
export type GltfFixtureName = (typeof GLTF_FIXTURE_NAMES)[number];

export function gltfFixture(name: GltfFixtureName): string {
  const text = sources[`../fixtures/gltf/${name}.gltf`];
  if (text === undefined) throw new Error(`fixture ${name} not found`);
  return text;
}

function inlineBytes(uri: string): Uint8Array {
  return fromBase64(uri.slice(uri.indexOf(',') + 1));
}

/** The files a user picks next to `external.gltf`. */
export function externalFiles(): ReadonlyMap<string, Uint8Array> {
  return new Map([
    ['external.bin', inlineBytes(externalBinUri)],
    ['external.png', inlineBytes(externalPngUri)],
  ]);
}

export function gltfFixtureFiles(name: GltfFixtureName): ReadonlyMap<string, Uint8Array> | undefined {
  return name === 'external' ? externalFiles() : undefined;
}
