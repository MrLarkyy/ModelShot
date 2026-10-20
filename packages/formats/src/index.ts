export const packageName = '@modelshot/formats';

export { BbmodelError, type BbmodelErrorCode } from './bbmodel/BbmodelError';
export { DEFAULT_BBMODEL_LIMITS, type BbmodelLimits, type BbmodelLoadOptions } from './bbmodel/BbmodelLoadOptions';
export type { BbmodelLoadResult } from './bbmodel/BbmodelLoadResult';
export { MAX_BBMODEL_WARNINGS, type BbmodelWarning, type BbmodelWarningCode } from './bbmodel/BbmodelWarning';
export { loadBbmodel } from './bbmodel/loadBbmodel';
export { SkinError, type SkinErrorCode } from './player/SkinError';
export { DEFAULT_SKIN_LIMITS, type SkinLimits } from './player/SkinLimits';
export type { SkinLayout, SkinLoadResult } from './player/SkinLoadResult';
export { MAX_SKIN_NAME_CHARS, loadSkin, type SkinLoadOptions } from './player/loadSkin';
export type { PlayerArms, PlayerModelOptions } from './player/PlayerModelOptions';
export { PLAYER_OUTER_ALPHA_CUTOFF, createPlayerModel } from './player/createPlayerModel';
