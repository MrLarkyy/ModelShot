import { DEFAULT_EMBED_PARAMS, EMBED_PARAMS_VERSION, type EmbedParams } from './EmbedParams';

/**
 * The frame page URL showing `params`: `frameBase` (the directory of the embed build) with every parameter in the
 * fragment, `v` first, defaults left out, so the server hosting the embed never sees them.
 */
export function embedFrameUrl(frameBase: string | URL, params: EmbedParams): string {
  const d = DEFAULT_EMBED_PARAMS;
  const fragment = new URLSearchParams({ v: String(EMBED_PARAMS_VERSION), model: params.model });
  if (params.look !== d.look) fragment.set('look', params.look);
  if (params.yawDeg !== d.yawDeg) fragment.set('yaw', String(params.yawDeg));
  if (params.pitchDeg !== d.pitchDeg) fragment.set('pitch', String(params.pitchDeg));
  if (params.fovDeg !== d.fovDeg) fragment.set('fov', String(params.fovDeg));
  if (params.autorotate) fragment.set('autorotate', '1');
  if (params.background !== null) fragment.set('background', params.background);
  if (params.arms !== d.arms) fragment.set('arms', params.arms);
  const url = new URL(frameBase);
  url.search = '';
  url.hash = fragment.toString();
  return url.href;
}
