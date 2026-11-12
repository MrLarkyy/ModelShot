import type { LookPreset } from '@modelshot/looks';
import type { SceneAnimation, SceneDocument, SceneTextureFilter } from '@modelshot/scene';
import type { SelectionTarget } from '../editor/Selection';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import type { NodeEdit } from '../session/NodeEdit';

/** What the Object, Material and Light tabs show. */
export interface InspectorModel {
  readonly doc: SceneDocument;
  readonly names: ReadonlyMap<string, string>;
  readonly selection: SelectionTarget | null;
  readonly edits: readonly NodeEdit[];
  readonly nodeVisible: readonly boolean[];
  readonly meshVisible: readonly boolean[];
  readonly lockedNodes: readonly boolean[];
  readonly lockedMeshes: readonly boolean[];
  readonly textureFilter: readonly SceneTextureFilter[];
  readonly player: { readonly arms: PlayerArmsChoice } | null;
  /** The clip the timeline shows, or null without clips. */
  readonly clip: SceneAnimation | null;
  readonly look: LookPreset;
}
