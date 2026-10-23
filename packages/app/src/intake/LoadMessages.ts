import type { SceneDocument } from '@modelshot/scene';
import type { LoadRequest } from './groupFiles';

export type PlayerArmsChoice = 'classic' | 'slim';

/** Main thread -> worker. `hang` is honoured in the e2e build only. */
export type LoadMessage = { readonly request: LoadRequest; readonly arms: PlayerArmsChoice; readonly hang?: boolean };

export interface LoadedModel {
  readonly doc: SceneDocument;
  readonly warnings: readonly string[];
  /** The name shown to the user: the model file's, or the skin's. */
  readonly name: string;
  readonly kind: 'model' | 'skin';
  /** SHA-256 hex of the model (or skin) file's bytes: the key of its stored state. */
  readonly key: string;
}

export type LoadReply =
  ({ readonly ok: true } & LoadedModel) | { readonly ok: false; readonly code: string; readonly message: string };
