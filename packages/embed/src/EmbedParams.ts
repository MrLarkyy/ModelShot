/** The version of the parameter contract (docs/embed.md). A change of meaning or a removal makes it 2. */
export const EMBED_PARAMS_VERSION = 1;

/** The fragment parameters of the frame page, in the order `embedFrameUrl` writes them. */
export const EMBED_PARAM_NAMES = [
  'v',
  'model',
  'look',
  'yaw',
  'pitch',
  'fov',
  'autorotate',
  'background',
  'arms',
] as const;

/** The attributes of `<modelshot-viewer>`: the parameters but `v`, plus two of the element's own. */
export const ELEMENT_ATTRIBUTE_NAMES = [
  'model',
  'look',
  'yaw',
  'pitch',
  'fov',
  'autorotate',
  'background',
  'arms',
  'loading',
  'label',
] as const;

/** The look preset ids of `@modelshot/looks` (`LOOK_PRESETS`; a test keeps them equal, the element does not load looks). */
export const EMBED_LOOKS = ['studio', 'marketplace', 'rim'] as const;
export const EMBED_ARMS = ['classic', 'slim'] as const;

/** Room for a 2048-character model URL percent-encoded three-fold (`:` -> `%3A`) and every other parameter. */
export const MAX_FRAGMENT_CHARS = 8192;
export const MAX_MODEL_URL_CHARS = 2048;
export const MAX_LABEL_CHARS = 200;

/** The camera's ranges and defaults (`OrbitController` and the app's `Viewer`; a test keeps them equal). */
export const EMBED_CAMERA = {
  minYawDeg: -360,
  maxYawDeg: 360,
  minPitchDeg: -89.5,
  maxPitchDeg: 89.5,
  minFovDeg: 10,
  maxFovDeg: 100,
  yawDeg: 210,
  pitchDeg: 20,
  fovDeg: 35,
} as const;

export type EmbedLook = (typeof EMBED_LOOKS)[number];
export type EmbedArms = (typeof EMBED_ARMS)[number];
export type EmbedParamName = (typeof EMBED_PARAM_NAMES)[number];
export type ElementAttributeName = (typeof ELEMENT_ATTRIBUTE_NAMES)[number];

/** What an embed shows, every field checked and filled in with its default. */
export interface EmbedParams {
  /** Absolute http(s) URL without credentials. */
  readonly model: string;
  readonly look: EmbedLook;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly fovDeg: number;
  readonly autorotate: boolean;
  /** `#rrggbb` (lower case), the colour shown behind the model; null keeps the look's backdrop. */
  readonly background: string | null;
  readonly arms: EmbedArms;
}

export const DEFAULT_EMBED_PARAMS: Omit<EmbedParams, 'model'> = Object.freeze({
  look: 'studio',
  yawDeg: EMBED_CAMERA.yawDeg,
  pitchDeg: EMBED_CAMERA.pitchDeg,
  fovDeg: EMBED_CAMERA.fovDeg,
  autorotate: false,
  background: null,
  arms: 'classic',
});
