import type { SceneMaterial } from './SceneMaterial';
import type { SceneMesh } from './SceneMesh';
import type { SceneNode } from './SceneNode';
import type { SceneTexture } from './SceneTexture';

/**
 * Version of the scene format. Growth that only adds optional fields with a defined default stays on this version;
 * anything else bumps it and ships a migration.
 */
export const SCENE_FORMAT_VERSION = 1;

export interface SceneSource {
  readonly format: 'bbmodel';
  /** Version string of the source file, e.g. `"4.10"`. */
  readonly formatVersion: string;
  /** Blockbench project format, e.g. `"free"` or `"bedrock"`; `"unknown"` when absent. */
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
