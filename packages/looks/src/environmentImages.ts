import softboxStudio from './environments/softbox-studio.hdr?url&inline';

/** Each bundled environment image (`ENVIRONMENT_IMAGE_IDS`) as the data URL the bundler inlined: no request, ever. */
const DATA_URLS: Readonly<Record<string, string>> = Object.freeze({ 'softbox-studio': softboxStudio });

/** The ids `environmentImageBytes` holds, for the test that keeps them equal to `ENVIRONMENT_IMAGE_IDS`. */
export const BUNDLED_ENVIRONMENT_IMAGES: readonly string[] = Object.freeze(Object.keys(DATA_URLS));

/** The `.hdr` bytes of the bundled environment image `id`; a `RangeError` for an id that is not one. */
export function environmentImageBytes(id: string): Uint8Array {
  const url = Object.hasOwn(DATA_URLS, id) ? DATA_URLS[id] : undefined;
  if (url === undefined) throw new RangeError(`"${id}" is not a bundled environment image`);
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
