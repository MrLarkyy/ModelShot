import type { OrbitState } from '@modelshot/renderer-rt';
import type { ExportSettings } from '../export/ExportSettings';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import type { RenderSettingsValues } from '../render/RenderSettings';

export const APP_STATE_VERSION = 1;
export const APP_DB = 'modelshot-app';
export const SESSION_STORE = 'session';
export const MODELS_STORE = 'models';
/** Most models whose view is remembered; the oldest is dropped for the next. */
export const MAX_STORED_MODELS = 20;

/** The files of the last open model, so the app can reopen them (never uploaded; "Forget local data" deletes them). */
export interface SessionState {
  readonly v: typeof APP_STATE_VERSION;
  readonly files: readonly File[];
  readonly modelKey: string;
  readonly savedAt: number;
}

/** What the user set up for one model, keyed by the SHA-256 of its file. */
export interface ModelState {
  readonly v: typeof APP_STATE_VERSION;
  readonly camera: OrbitState;
  /** Id of a preset of `LOOK_PRESETS`. */
  readonly look: string;
  /** Indices into `SceneDocument.nodes` / `meshes` that are hidden. */
  readonly hiddenNodes: readonly number[];
  readonly hiddenMeshes: readonly number[];
  readonly arms?: PlayerArmsChoice;
  readonly render: RenderSettingsValues;
  readonly export?: ExportSettings;
  readonly savedAt: number;
}
