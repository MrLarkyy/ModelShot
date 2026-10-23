import { IntakeError } from './IntakeError';

export type LoadRequest =
  | { readonly kind: 'model'; readonly model: File; readonly resources: readonly File[] }
  | { readonly kind: 'skin'; readonly skin: File };

const MODEL_EXTENSIONS = ['.bbmodel', '.gltf', '.glb', '.obj'];

const hasExtension = (file: File, extensions: readonly string[]): boolean => {
  const name = file.name.toLowerCase();
  return extensions.some((extension) => name.endsWith(extension));
};

// One model file with the files next to it (buffers, textures, material libraries) is one load; a lone PNG is a
// Minecraft skin. Which model format a file is, is decided from its bytes in the worker.
export function groupFiles(files: readonly File[]): LoadRequest {
  const models = files.filter((file) => hasExtension(file, MODEL_EXTENSIONS));
  const [model] = models;
  if (models.length > 1) {
    throw new IntakeError('MULTIPLE_MODELS', `Choose one model at a time: ${models.length} model files were given.`);
  }
  if (!model) {
    const [only] = files;
    if (files.length === 1 && only && hasExtension(only, ['.png'])) return { kind: 'skin', skin: only };
    throw new IntakeError(
      'NO_MODEL',
      'No model file among them: add a .bbmodel, .gltf, .glb or .obj, or one skin PNG.',
    );
  }
  return { kind: 'model', model, resources: files.filter((file) => file !== model) };
}
