import type { SceneDocument } from '@modelshot/scene';
import type { MeshMessage } from '../bake/meshStream';
import type { GeometryParams, PreparedGeometry } from './prepareGeometry';

/** Main thread to geometry worker: meshes (`streamMeshes`), then the request naming them. Never texture bytes. */
export type GeometryRequest =
  | MeshMessage
  | {
      readonly type: 'prepare';
      readonly id: number;
      /** The document without meshes, materials and textures: what flattening reads besides the meshes. */
      readonly doc: SceneDocument;
      /** The document's meshes, by the ids they were streamed under in this or an earlier request. */
      readonly meshIds: readonly number[];
      readonly params: GeometryParams;
    };

/** Geometry worker to main thread. */
export type GeometryReply =
  /** The buffers are transferred. */
  | { readonly type: 'prepared'; readonly id: number; readonly prepared: PreparedGeometry }
  | {
      readonly type: 'error';
      readonly id: number;
      readonly name: string;
      readonly code: string;
      /** Without the ` (at path)` suffix a `PathTracerError` adds. */
      readonly message: string;
      readonly path: string;
    }
  /** The worker lacks a mesh the request names: post everything again. */
  | { readonly type: 'resend'; readonly id: number };
