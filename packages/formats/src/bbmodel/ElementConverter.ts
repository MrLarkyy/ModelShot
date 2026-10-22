import type { SceneMesh } from '@modelshot/scene';
import type { BbmodelWarningList } from './BbmodelWarning';
import type { JsonObject } from '../json/JsonObject';
import type { UvSize } from './parseTextures';
import type { TextureRule } from './TextureRule';

/** What an element converter may know about the model besides the element itself. */
export interface ConverterContext {
  /** UV size of each texture, indexed like the file's `textures`; its length bounds face texture indices. */
  readonly textureUvSizes: readonly UvSize[];
  /** Texture index by texture uuid, for faces that name their texture by uuid. */
  readonly textureIds: ReadonlyMap<string, number>;
  /** Whether faces with each texture show their back (texture `render_sides` resolved for the model format). */
  readonly textureDoubleSided: readonly boolean[];
  /**
   * Whether each texture's `render_sides` is `auto` (sided by the model format); a material past the textures (a layer
   * composite) and untextured faces count as `auto`. An inverted cube draws those faces single-sided (`readCube`).
   */
  readonly textureSidesAuto: readonly boolean[];
  /** Whether untextured faces show their back (the model format's rule). */
  readonly untexturedDoubleSided: boolean;
  /** The model format's face texture rule (Blockbench `Face.getTexture`); absent: `perFace`. */
  readonly textureRule?: TextureRule;
  /** `Format.per_group_texture`: under `singleDefault` every face, not only a blank one, shows the default texture. */
  readonly perGroupTexture?: boolean;
  /** Blockbench's default texture (`defaultTexture`); absent or −1 for none. */
  readonly defaultTexture?: number;
  /**
   * Texture every face of the element shows, overriding `textureRule`: its parent group's in a per-group-texture
   * format, or a Hytale cube's collection texture (or the default texture outside every collection); absent when
   * none applies, −1 when it names a texture that does not exist (Blockbench then draws the face untextured).
   */
  readonly groupTexture?: number;
  /** Material of the layer composite that every drawn face uses; absent when no texture is layered. */
  readonly layeredMaterial?: number;
  /** Project UV size, used for faces without a texture. */
  readonly resolution: UvSize;
  /** Project-wide box UV (`meta.box_uv`); an element may override it. */
  readonly boxUv: boolean;
  /** A box-UV project before format 4.5: a cube's `shade: false` means mirrored UV (Blockbench's import). */
  readonly shadeMirrorsUv?: boolean;
  /** Box-UV sizes are not floored (Blockbench `box_uv_float_size`: `modded_entity` and the Hytale formats). */
  readonly boxUvFloatSize: boolean;
  readonly maxStringChars: number;
  readonly maxVertices: number;
  readonly maxFaceVertices: number;
  readonly warnings: BbmodelWarningList;
}

/** A validated element, ready to become a mesh; holds no buffers yet. */
export interface PreparedElement {
  /** Upper bound of the triangles `build` produces. */
  readonly triangleCount: number;
  /** Upper bound of the vertices `build` produces. */
  readonly vertexCount: number;
  /**
   * `textureFrameCounts` holds the frame count of each texture (1 for a still); v of a face on a strip is divided by
   * it, so the face shows frame 0.
   */
  build(node: number, textureFrameCounts: readonly number[]): SceneMesh;
}

/**
 * Turns one element `type` into a mesh in two steps, so every element is validated and counted before any geometry is
 * allocated.
 */
export interface ElementConverter {
  prepare(element: JsonObject, path: string, context: ConverterContext): PreparedElement;
}
