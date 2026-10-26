import { EmbedError } from './EmbedError';
import { MAX_FRAGMENT_CHARS } from './EmbedParams';
import { parseEmbedParams, type ParsedEmbedParams } from './parseEmbedParams';

/**
 * The frame page's parameters from its URL fragment (`location.hash`, with or without the `#`). The query string is
 * never read: a fragment does not reach the server that hosts the embed.
 */
export function parseEmbedFragment(hash: string): ParsedEmbedParams {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment.length > MAX_FRAGMENT_CHARS) {
    throw new EmbedError('INVALID_PARAM', `The embed parameters are longer than ${MAX_FRAGMENT_CHARS} characters.`);
  }
  return parseEmbedParams(new URLSearchParams(fragment));
}
