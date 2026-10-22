import { animateScene, type SceneDocument } from '@modelshot/scene';
import type { CheckedAnimationOptions } from './checkExportOptions';
import { ExportError } from './ExportError';

/**
 * The pose of an animation export at playback `time`, computed from the rest pose (`animateScene`), so frame i is
 * what a seek to that time shows. A malformed animation throws `ExportError` `INVALID_OPTION` naming `animation`.
 */
export function framePose(doc: SceneDocument, options: CheckedAnimationOptions, time: number): SceneDocument {
  try {
    return animateScene(doc, { animation: options.animation, time, loop: options.loop }).document;
  } catch (error) {
    throw new ExportError(
      'INVALID_OPTION',
      `animation ${options.animation}: ${error instanceof Error ? error.message : String(error)}`,
      'animation',
      { cause: error },
    );
  }
}
