/**
 * Ids of the environment images bundled with the package, the only values `LookHdriEnvironment.image` takes: a look
 * file never names a URL or a path, so a look never makes a request. Kept apart from the image data
 * (`environmentImages.ts`), so the format check stays free of the asset.
 */
export const ENVIRONMENT_IMAGE_IDS: readonly string[] = Object.freeze(['softbox-studio']);
