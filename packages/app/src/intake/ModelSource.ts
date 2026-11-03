import {
  DEFAULT_GLTF_LIMITS,
  DEFAULT_OBJ_LIMITS,
  GltfError,
  ObjError,
  SkinError,
  decodeObjText,
  detectModelFormat,
  listGltfReferences,
  listObjReferences,
  loadBbmodel,
  loadGltf,
  loadObj,
  readGltfContainer,
  type DecodedObjText,
  type GltfContainer,
} from '@modelshot/formats';
import type { SceneDocument } from '@modelshot/scene';
import type { LoadedModel } from './LoadMessages';
import { sha256Hex } from './sha256Hex';

/** What a model file was read into: the form its loader and its reference lister both take. */
type Parsed =
  | { readonly format: 'gltf'; readonly container: GltfContainer }
  | { readonly format: 'obj'; readonly text: DecodedObjText }
  | { readonly format: 'bbmodel' | 'other' }
  // The loader's refusal, kept for the load to report: a file it refuses lists nothing.
  | { readonly format: 'refused'; readonly error: GltfError | ObjError };

async function readFileBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.arrayBuffer());
}

function parse(file: File, bytes: Uint8Array): Parsed {
  const format = detectModelFormat(file.name, bytes.subarray(0, 4));
  try {
    if (format === 'gltf' || format === 'glb') {
      return { format: 'gltf', container: readGltfContainer(bytes, DEFAULT_GLTF_LIMITS.maxFileBytes) };
    }
    if (format === 'obj')
      return { format: 'obj', text: decodeObjText(bytes, file.name, DEFAULT_OBJ_LIMITS.maxFileBytes) };
  } catch (error) {
    if (error instanceof GltfError || error instanceof ObjError) return { format: 'refused', error };
    throw error;
  }
  // MS-82 adds the .bbmodel texture references here.
  return { format: format === 'bbmodel' ? 'bbmodel' : 'other' };
}

/**
 * A model file read and parsed once in the load worker: its references are listed from the parsed form, and the model
 * is loaded from it after the files they name were fetched. The loaders' own limits apply as for a file loaded whole.
 */
export class ModelSource {
  private constructor(
    readonly file: File,
    private readonly bytes: Uint8Array<ArrayBuffer>,
    private readonly parsed: Parsed,
  ) {}

  static async open(file: File): Promise<ModelSource> {
    const bytes = await readFileBytes(file);
    return new ModelSource(file, bytes, parse(file, bytes));
  }

  /** The files the model refers to, as its lister returns them (at most `maxReferences + 1`). */
  references(maxReferences: number): string[] {
    const limit = { maxReferences };
    if (this.parsed.format === 'gltf') return listGltfReferences(this.parsed.container, limit);
    if (this.parsed.format === 'obj') return listObjReferences(this.parsed.text, limit);
    return [];
  }

  /** The model with `resources` picked next to it; throws what loading the file whole throws. */
  async load(resources: readonly File[]): Promise<LoadedModel> {
    const files = new Map<string, Uint8Array>();
    for (const resource of resources) files.set(resource.name, await readFileBytes(resource));
    const { parsed, bytes, file } = this;
    let doc: SceneDocument;
    let warnings: readonly { readonly message: string }[];
    if (parsed.format === 'refused') throw parsed.error;
    if (parsed.format === 'bbmodel') ({ scene: doc, warnings } = loadBbmodel(bytes, { textureFiles: files }));
    else if (parsed.format === 'gltf') ({ scene: doc, warnings } = loadGltf(parsed.container, { files }));
    else if (parsed.format === 'obj') ({ scene: doc, warnings } = loadObj(parsed.text, { files, fileName: file.name }));
    else throw new SkinError('NOT_PNG', 'not a model file');
    return {
      doc,
      warnings: warnings.map((warning) => warning.message),
      name: file.name,
      kind: 'model',
      key: await sha256Hex(bytes),
    };
  }
}
