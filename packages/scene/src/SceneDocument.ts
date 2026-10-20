import type { SceneAttachment } from './SceneAttachment';
import type { SceneMaterial } from './SceneMaterial';
import type { SceneMesh } from './SceneMesh';
import type { SceneNode } from './SceneNode';
import type { ScenePose } from './ScenePose';
import type { SceneTexture } from './SceneTexture';

/**
 * Version of the scene format. Growth that only adds optional fields with a defined default stays on this version;
 * anything else bumps it and ships a migration.
 */
export const SCENE_FORMAT_VERSION = 1;

/**
 * Where a scene came from: a loaded file (`gltf` covers `.gltf` and `.glb`; `gltf` and `obj` added within version 1,
 * MS-13), or `player`, built by `createPlayerModel` from a skin.
 */
export type SceneSourceFormat = 'bbmodel' | 'gltf' | 'obj' | 'player';

export interface SceneSource {
  readonly format: SceneSourceFormat;
  /**
   * Version string of the source: `bbmodel` `meta.format_version` (e.g. `"4.10"`), `gltf` `asset.version` (`"2.0"`),
   * `obj` `""` (OBJ has no version), `player` the skin layout (`"64x64"` or `"64x32"`).
   */
  readonly formatVersion: string;
  /**
   * `bbmodel`: the Blockbench project format, e.g. `"free"` or `"bedrock"`, `"unknown"` when absent; `gltf`: the
   * container, `"gltf"` or `"glb"`; `obj`: `"obj"`; `player`: its arms.
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
  /**
   * The pose `poseScene` last applied to this document (the nodes already carry it); absent: none applied. Not a
   * statement about every node: a model merged in by `attachModel` keeps its own posed node rotations until the next
   * `poseScene` returns them to rest.
   */
  readonly pose?: ScenePose;
  /** Models merged in by `attachModel` (the nodes and meshes already carry them); absent: none. */
  readonly attachments?: readonly SceneAttachment[];
}
