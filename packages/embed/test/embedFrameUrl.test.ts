import { describe, expect, it } from 'vitest';
import { DEFAULT_EMBED_PARAMS, type EmbedParams } from '../src/EmbedParams';
import { embedFrameUrl } from '../src/embedFrameUrl';
import { parseEmbedFragment } from '../src/parseEmbedFragment';

const BASE = 'https://embed.example/v1/';
const MODEL = 'https://models.example/a+b%20c.bbmodel?x=1&y=2#part';

describe('embedFrameUrl', () => {
  it('writes only v and the model for the defaults, in the fragment', () => {
    const params: EmbedParams = { model: 'https://models.example/cube.bbmodel', ...DEFAULT_EMBED_PARAMS };
    expect(embedFrameUrl(BASE, params)).toBe(
      'https://embed.example/v1/#v=1&model=https%3A%2F%2Fmodels.example%2Fcube.bbmodel',
    );
  });

  it.each<Partial<EmbedParams>>([
    {},
    { look: 'marketplace', yawDeg: -12.5, pitchDeg: 89.5, fovDeg: 10 },
    { autorotate: true, background: '#1b2a4a', arms: 'slim' },
    { look: 'rim', yawDeg: 0, pitchDeg: -89.5, fovDeg: 100, autorotate: true, background: '#000000' },
  ])('round-trips through parseEmbedFragment: %j', (changes) => {
    const params: EmbedParams = { model: MODEL, ...DEFAULT_EMBED_PARAMS, ...changes };
    const url = new URL(embedFrameUrl(BASE, params));
    expect(url.search).toBe('');
    expect(`${url.origin}${url.pathname}`).toBe(BASE);
    expect(parseEmbedFragment(url.hash)).toEqual({ params, ignored: [] });
  });

  it('drops a query of the base, so nothing reaches the embed server', () => {
    const params: EmbedParams = { model: MODEL, ...DEFAULT_EMBED_PARAMS };
    expect(new URL(embedFrameUrl(`${BASE}?track=1`, params)).search).toBe('');
  });
});
