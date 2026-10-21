import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

// Replaces <!-- brand:<name> --> in index.html with the committed SVG, so the page carries the generated
// artwork inline (no extra request, colours from the token CSS classes) and never a hand-copied one.
export function inlineBrandSvg(slots: Readonly<Record<string, string>>): Plugin {
  return {
    name: 'modelshot-inline-brand-svg',
    transformIndexHtml(html) {
      return html.replace(/<!-- brand:([a-z-]+) -->/g, (_match, name: string) => {
        const file = slots[name];
        if (file === undefined) throw new Error(`index.html asks for an unknown brand slot "${name}"`);
        return readFileSync(file, 'utf8').trim().replace(' xmlns="http://www.w3.org/2000/svg"', '');
      });
    },
  };
}
