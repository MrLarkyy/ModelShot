import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../src/renderTokensCss';
import { tokens } from '../src/tokens';

describe('tokens', () => {
  it('css/tokens.css is generated from tokens.ts', async () => {
    await expect(renderTokensCss('core')).toMatchFileSnapshot('../css/tokens.css');
  });

  it('css/illustration.css is generated from tokens.ts', async () => {
    await expect(renderTokensCss('illustration')).toMatchFileSnapshot('../css/illustration.css');
  });

  it('writes every brand colour as #RRGGBB', () => {
    for (const value of Object.values(tokens.color)) expect(value).toMatch(/^#[\dA-F]{6}$/);
  });

  it('names custom properties --ms-<group>-<name> in kebab case', () => {
    const core = renderTokensCss('core');
    expect(core).toContain('--ms-color-shot-blue: #2F4BFF;');
    expect(core).toContain('--ms-space-8: 112px;');
    expect(core).toContain('--ms-motion-float: 6000ms;');
    expect(core).toContain('--ms-focus-width: 3px;');
    expect(core).toContain('--ms-weight-heavy: 800;');
  });

  it('keeps illustration colours out of the core file the app loads', () => {
    expect(renderTokensCss('core')).not.toContain('--ms-ill-');
    expect(renderTokensCss('illustration')).toContain('--ms-ill-grass-top: #9BE37F;');
  });

  it('focus ring colours are brand colours', () => {
    expect(tokens.focus.ring).toBe(tokens.color.ink);
    expect(tokens.focus.onDark).toBe(tokens.color.sun);
  });
});
