import type { SceneMesh } from '@modelshot/scene';
import type { JsonObject } from './JsonFields';
import type { UvSize } from './parseTextures';

/** What an element converter may know about the model besides the element itself. */
export interface ConverterContext {
  /** UV size of each texture, indexed like the file's `textures`; its length bounds face texture indices. */
  readonly textureUvSizes: readonly UvSize[];
  /** Texture index by texture uuid, for faces that name their texture by uuid. */
  readonly textureIds: ReadonlyMap<string, number>;
  /** Project UV size, used for faces without a texture. */
  readonly resolution: UvSize;
  /** Project-wide box UV (`meta.box_uv`); an element may override it. */
  readonly boxUv: boolean;
  /** Box-UV sizes are not floored (Blockbench `box_uv_float_size`, only `modded_entity`). */
  readonly boxUvFloatSize: boolean;
  readonly maxStringChars: number;
}

/** A validated element, ready to become a mesh; holds no buffers yet. */
export interface PreparedElement {
  readonly triangleCount: number;
  build(node: number): SceneMesh;
}

/**
 * Turns one element `type` into a mesh in two steps, so every element is validated and counted before any geometry is
 * allocated.
 */
export interface ElementConverter {
  prepare(element: JsonObject, path: string, context: ConverterContext): PreparedElement;
}
