import type { SceneDocument } from '@modelshot/scene';
import type { LoadRequest } from './groupFiles';

export type PlayerArmsChoice = 'classic' | 'slim';

/**
 * Main thread -> worker. `listed`: the model is the File this worker's last model list read, to be loaded from what
 * that list parsed. `hang` is honoured in the e2e build only.
 */
export type LoadMessage = {
  readonly request: LoadRequest;
  readonly arms: PlayerArmsChoice;
  readonly listed?: true;
  readonly hang?: boolean;
};

/** Whose references to list: the model's (the worker keeps it read for the load), or a material library's. */
export type ReferenceSource = 'model' | 'library';

/** Main thread -> worker: the files `file` refers to, at most `maxReferences + 1` of them. */
export type ListMessage = {
  readonly list: { readonly file: File; readonly of: ReferenceSource; readonly maxReferences: number };
};

export interface LoadedModel {
  readonly doc: SceneDocument;
  readonly warnings: readonly string[];
  /** The name shown to the user: the model file's, or the skin's. */
  readonly name: string;
  readonly kind: 'model' | 'skin';
  /** SHA-256 hex of the model (or skin) file's bytes: the key of its stored state. */
  readonly key: string;
}

export type LoadFailure = { readonly ok: false; readonly code: string; readonly message: string };

export type LoadReply = ({ readonly ok: true } & LoadedModel) | LoadFailure;

export type ListReply = { readonly ok: true; readonly references: readonly string[] } | LoadFailure;
