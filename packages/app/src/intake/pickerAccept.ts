import { ACCEPTED_MODEL_EXTENSIONS, ACCEPTED_RESOURCE_EXTENSIONS } from '@modelshot/formats';

export type EntryKind = 'bbmodel' | 'skin' | 'gltf-obj';

const join = (extensions: readonly string[]): string => extensions.join(',');

/** Every file the app can open, as the file picker's `accept`. */
export const PICKER_ACCEPT = join([...ACCEPTED_MODEL_EXTENSIONS, ...ACCEPTED_RESOURCE_EXTENSIONS]);

const IMAGES = ['.png', '.jpg', '.jpeg'] as const;

const ENTRY_EXTENSIONS: Readonly<Record<EntryKind, readonly string[]>> = {
  bbmodel: ['.bbmodel', ...IMAGES],
  skin: ['.png'],
  'gltf-obj': ['.gltf', '.glb', '.bin', '.obj', '.mtl', ...IMAGES],
};

/** The picker's `accept` of one entry card: the model kind with the resources it can bring along. */
export function entryAccept(kind: EntryKind): string {
  return join(ENTRY_EXTENSIONS[kind]);
}
