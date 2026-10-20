export const packageName = '@modelshot/looks';

export { agxToneMap, type Rgb } from './agxToneMap';
export { LIGHT_RIG_V0, unoccludedRadiance, type LightRig } from './lightRig';
export { linkShader, type ShaderChunks } from './linkShader';
export { lookShaderChunks } from './lookShaderChunks';
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
