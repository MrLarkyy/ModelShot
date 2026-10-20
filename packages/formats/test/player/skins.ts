import classicUri from '../fixtures/skins/skin-classic.png?inline';
import legacyUri from '../fixtures/skins/skin-legacy.png?inline';
import slimUri from '../fixtures/skins/skin-slim.png?inline';
import { base64Bytes } from '../bbmodel/fixtures';

const URIS = { classic: classicUri, slim: slimUri, legacy: legacyUri } as const;

export type SkinFixture = keyof typeof URIS;

/** The generated test skin (generate.mjs) as the bytes a user would pick. */
export function skinBytes(name: SkinFixture): Uint8Array {
  const uri = URIS[name];
  return base64Bytes(uri.slice(uri.indexOf(',') + 1));
}
