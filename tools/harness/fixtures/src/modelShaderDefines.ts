import { BACK_SIDE_RENDER_ORDER, RENDER_ORDER_TIE_DISTANCE } from '@modelshot/scene';
import { MODEL_VIEW_LOOK } from './modelViewCamera';
import { MAX_MATERIALS, MODE_CODES } from './sceneUpload';
import type { ShaderDefine } from './shaderSource';

/** Every constant the model-view shaders share with this code, injected as `#define`s so each has one source. */
export const MODEL_SHADER_DEFINES: Readonly<Record<string, ShaderDefine>> = Object.freeze({
  MAX_MATERIALS: { int: MAX_MATERIALS },
  MODE_OPAQUE: { int: MODE_CODES.opaque },
  MODE_MASK: { int: MODE_CODES.mask },
  MODE_BLEND: { int: MODE_CODES.blend },
  RENDER_ORDER_TIE: { float: RENDER_ORDER_TIE_DISTANCE },
  BACK_SIDE_RENDER_ORDER: { float: BACK_SIDE_RENDER_ORDER },
  SHADOW_NORMAL_OFFSET: { float: MODEL_VIEW_LOOK.shadowNormalOffset },
  /**
   * The raster writes the render-order key over this as its depth: view depth (at most the far plane) plus at most
   * |order| × TIE behind it, so far + 1 holds every key of the fixtures (|order| ≤ 1, scene keys ≤ far).
   */
  DEPTH_RANGE: { float: MODEL_VIEW_LOOK.far + 1 },
});
