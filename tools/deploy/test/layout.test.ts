import { describe, expect, it } from 'vitest';
import { EMBED_PARAMS_VERSION } from '../../../packages/embed/src/EmbedParams.ts';
import { DEPLOY_LAYOUT, EMBED_PATH_MAJOR } from '../src/layout.ts';

describe('deploy layout', () => {
  it('names the embed folder after the embed contract version', () => {
    expect(EMBED_PATH_MAJOR).toBe(EMBED_PARAMS_VERSION);
    expect(DEPLOY_LAYOUT.map((entry) => entry.target)).toContain(`embed/v${EMBED_PARAMS_VERSION}/`);
  });

  it('has unique, relative targets that end with a slash', () => {
    const targets = DEPLOY_LAYOUT.map((entry) => entry.target);
    expect(new Set(targets).size).toBe(targets.length);
    for (const target of targets) {
      expect(target.startsWith('/'), target).toBe(false);
      expect(target.endsWith('/'), target).toBe(true);
    }
  });
});
