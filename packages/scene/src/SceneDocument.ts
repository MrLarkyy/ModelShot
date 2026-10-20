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

export interface SceneSource {
  /** `player`: built by `createPlayerModel` from a skin. */
  readonly format: 'bbmodel' | 'player';
  /** Version string of the source file, e.g. `"4.10"`; for a player the skin layout, `"64x64"` or `"64x32"`. */
  readonly formatVersion: string;
  /** Blockbench project format, e.g. `"free"` or `"bedrock"`, `"unknown"` when absent; for a player its arms. */
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
  /** The pose `poseScene` applied (the nodes already carry it); absent: rest. */
  readonly pose?: ScenePose;
  /** Models merged in by `attachModel` (the nodes and meshes already carry them); absent: none. */
  readonly attachments?: readonly SceneAttachment[];
}
