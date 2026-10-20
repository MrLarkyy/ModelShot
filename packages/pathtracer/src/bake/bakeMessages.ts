import type { BakedLighting } from '@modelshot/renderer-rt';
import type { SceneDocument } from '@modelshot/scene';
import type { PathTracerWarning } from '../PathTracerWarning';

/** Main thread to bake worker. */
export type BakeRequest =
  | {
      readonly type: 'bake';
      readonly id: number;
      /** Texture bytes are `null` when `texturesVersion` was sent before: the worker reuses what it decoded. */
      readonly doc: SceneDocument;
      readonly texturesVersion: number;
      readonly texturesIncluded: boolean;
      readonly seed: number;
      readonly samples: number;
      readonly shadowCatcher: boolean;
      readonly tileSize: number;
      readonly maxTriangles: number;
    }
  | { readonly type: 'dispose' }
  | { readonly type: 'loseContext' };

/** Bake worker to main thread. */
export type BakeReply =
  | { readonly type: 'progress'; readonly id: number; readonly lighting: BakedLighting }
  | {
      readonly type: 'done';
      readonly id: number;
      readonly lighting: BakedLighting;
      readonly warnings: readonly PathTracerWarning[];
    }
  /** The bake stopped for a later request or dispose; nothing of it is kept. */
  | { readonly type: 'stopped'; readonly id: number }
  /** The worker's context was lost and is back: the bake started again at sample 0. */
  | { readonly type: 'restarted'; readonly id: number }
  | {
      readonly type: 'error';
      readonly id: number;
      readonly name: string;
      readonly code: string;
      readonly message: string;
      readonly path: string;
    }
  | { readonly type: 'disposed' };

/** Samples after which a bake reports its lighting so far (and always after its last sample). */
export function progressSamples(samples: number): number[] {
  const marks: number[] = [];
  for (let mark = 4; mark < samples; mark *= 4) marks.push(mark);
  marks.push(samples);
  return marks;
}
