export const packageName = '@modelshot/looks';

export { agxToneMap, type Rgb } from './agxToneMap';
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
