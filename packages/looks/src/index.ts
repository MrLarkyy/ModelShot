export const packageName = '@modelshot/looks';

export { agxToneMap, isNeutralGrade, type Rgb } from './agxToneMap';
export { backdropColor } from './backdropColor';
export { catcherShade } from './catcherShade';
export { MAX_LOOK_COLOR, checkLookPreset } from './checkLookPreset';
export { EDGE_LOOK_V0, MAX_EDGE_WIDTH, checkEdgeLook, type EdgeLook } from './EdgeLook';
export { checkBackground } from './checkBackground';
export { edgeRamp, roundedNormal } from './edgeRounding';
export { LIGHT_RIG_V0, rimLight, rimWorldDirection, unoccludedRadiance, type LightRig } from './lightRig';
export { lightingKey } from './lightingKey';
export { linkShader, type ShaderChunks } from './linkShader';
export {
  LOOK_FORMAT,
  LOOK_FORMAT_VERSION,
  type Direction,
  type LookBackdrop,
  type LookCatcher,
  type LookDirectionalLight,
  type LookEnvironment,
  type LookGrade,
  type LookKeyLight,
  type LookLights,
  type LookPreset,
  type LookRimLight,
  type LookToneMapping,
} from './LookPreset';
export { LOOK_VIEW_NONE, lookView, towardEye, type LookView } from './LookView';
export { LookPresetError, type LookPresetErrorCode } from './LookPresetError';
export { DEFAULT_LOOK, LOOK_PRESETS } from './lookPresets';
export { lookShaderChunks } from './lookShaderChunks';
export { LOOK_UNIFORM_NAMES, uploadLookUniforms, type LookUniformName, type LookUniformTarget } from './lookUniforms';
export { MAX_LOOK_PRESET_LENGTH, parseLookPreset } from './parseLookPreset';
export {
  ALPHA_MODE_ID,
  COVERAGE_INVISIBLE,
  COVERAGE_OPAQUE,
  COVERAGE_PARTIAL,
  alphaCutoffByte,
  texelCoverageByte,
  type AlphaModeId,
  type CoverageId,
} from './texelAlpha';
export {
  MAX_TEXTURE_FLAG_FRAMES,
  TEXTURE_FLAG_REPEAT,
  TEXTURE_FRAMES_SHIFT,
  textureSamplingFlags,
  type TextureSamplingInput,
} from './textureSamplingFlags';
