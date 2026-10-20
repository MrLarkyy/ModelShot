/** Model files a user can open, lower case with the dot (for a file input's `accept`). */
export const ACCEPTED_MODEL_EXTENSIONS = ['.bbmodel', '.gltf', '.glb', '.obj'] as const;

/** Files a user can pick next to a model: glTF buffers, PNG textures, OBJ material libraries. */
export const ACCEPTED_RESOURCE_EXTENSIONS = ['.bin', '.png', '.mtl'] as const;

/** `gltf` and `glb` both load with `loadGltf`. */
export type ModelFormat = 'bbmodel' | 'gltf' | 'glb' | 'obj';

const BY_EXTENSION: Readonly<Record<(typeof ACCEPTED_MODEL_EXTENSIONS)[number], ModelFormat>> = {
  '.bbmodel': 'bbmodel',
  '.gltf': 'gltf',
  '.glb': 'glb',
  '.obj': 'obj',
};

/**
 * The format of a picked file: a GLB header (`glTF` magic) in `head` wins over the name, otherwise the case-insensitive
 * extension decides; `null` for anything else.
 */
export function detectModelFormat(fileName: string, head?: Uint8Array): ModelFormat | null {
  if (head && head.length >= 4 && head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) {
    return 'glb';
  }
  const dot = fileName.lastIndexOf('.');
  const extension = dot < 0 ? '' : fileName.slice(dot).toLowerCase();
  const accepted = ACCEPTED_MODEL_EXTENSIONS.find((candidate) => candidate === extension);
  return accepted === undefined ? null : BY_EXTENSION[accepted];
}
