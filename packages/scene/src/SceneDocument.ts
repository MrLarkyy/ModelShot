import type { SceneMaterial } from './SceneMaterial';
import type { SceneMesh } from './SceneMesh';
import type { SceneNode } from './SceneNode';
import type { SceneTexture } from './SceneTexture';

/**
 * Version of the scene format. Growth that only adds optional fields with a defined default stays on this version;
 * anything else bumps it and ships a migration.
 */
export const SCENE_FORMAT_VERSION = 1;

/** The file format a scene was loaded from; `gltf` covers `.gltf` and `.glb` (added within version 1, MS-13). */
export type SceneSourceFormat = 'bbmodel' | 'gltf' | 'obj';

export interface SceneSource {
  readonly format: SceneSourceFormat;
  /**
   * Version string of the source file: `bbmodel` `meta.format_version` (e.g. `"4.10"`), `gltf` `asset.version`
   * (`"2.0"`), `obj` `""` (OBJ has no version).
   */
  readonly formatVersion: string;
  /**
   * `bbmodel`: the Blockbench project format, e.g. `"free"` or `"bedrock"`, `"unknown"` when absent; `gltf`: the
   * container, `"gltf"` or `"glb"`; `obj`: `"obj"`.
   */
  readonly modelFormat: string;
}

/**
 * A loaded model, independent of its file format. Units: 1 = 1/16 block; y up; right-handed; every cross reference is
 * an array index. Nodes are ordered parents before children.
 */
export interface SceneDocument {
  readonly formatVersion: typeof SCENE_FORMAT_VERSION;
  readonly source: SceneSource;
  readonly nodes: readonly SceneNode[];
  readonly meshes: readonly SceneMesh[];
  readonly materials: readonly SceneMaterial[];
  readonly textures: readonly SceneTexture[];
  /** Nodes without a parent, in source order. */
  readonly rootNodes: readonly number[];
}
