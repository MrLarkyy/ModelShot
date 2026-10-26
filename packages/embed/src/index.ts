export const packageName = '@modelshot/embed';

export { EMBED_ERROR_CODES, EmbedError, type EmbedErrorCode } from './EmbedError';
export {
  DEFAULT_EMBED_PARAMS,
  ELEMENT_ATTRIBUTE_NAMES,
  EMBED_PARAM_NAMES,
  EMBED_PARAMS_VERSION,
  MAX_FRAGMENT_CHARS,
  MAX_LABEL_CHARS,
  MAX_MODEL_URL_CHARS,
  type EmbedParams,
} from './EmbedParams';
export { embedFrameUrl } from './embedFrameUrl';
export { parseEmbedFragment } from './parseEmbedFragment';
export { parseEmbedParams, type ParsedEmbedParams } from './parseEmbedParams';
