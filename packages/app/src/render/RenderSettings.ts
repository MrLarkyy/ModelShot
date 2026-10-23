export interface RenderSettingsValues {
  samples: number;
  supersample: number;
  denoise: boolean;
}

export const DEFAULT_RENDER_SETTINGS: Readonly<RenderSettingsValues> = Object.freeze({
  samples: 256,
  supersample: 1,
  denoise: false,
});

/** Every render and export of the app starts from this seed, so the same scene gives the same image. */
export const RENDER_SEED = 1;

/** The pathtracer's MAX_SUPERSAMPLE, repeated so the page does not load the tracer to build its menu (tested equal). */
export const MAX_SUPERSAMPLE_CHOICE = 4;
