import { ISLAND_FACES, ISLAND_MATERIALS } from './illustration/islandClasses';
import { tokens, type Tokens } from './tokens';

export type TokensCssPart = 'core' | 'illustration';

type TokenTree = { readonly [key: string]: string | number | TokenTree | readonly number[] };

const UNIT: Partial<Record<keyof Tokens, string>> = {
  size: 'px',
  radius: 'px',
  space: 'px',
  motion: 'ms',
  focus: 'px',
};

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function formatValue(group: string, value: string | number): string {
  if (typeof value === 'string') return value;
  return `${value}${UNIT[group as keyof Tokens] ?? ''}`;
}

function declarations(prefix: string, group: string, tree: TokenTree | readonly number[]): string[] {
  if (Array.isArray(tree)) {
    return tree.map((value: number, index) => `  ${prefix}-${index + 1}: ${formatValue(group, value)};`);
  }
  return Object.entries(tree as TokenTree).flatMap(([key, value]) =>
    typeof value === 'object'
      ? declarations(`${prefix}-${kebab(key)}`, group, value)
      : [`  ${prefix}-${kebab(key)}: ${formatValue(group, value)};`],
  );
}

const HEADER = '/* Generated from packages/brand/src/tokens.ts by renderTokensCss; run pnpm golden:update:data. */\n';

function coreCss(source: Tokens): string {
  const lines = Object.entries(source)
    .filter(([group]) => group !== 'illustration')
    .flatMap(([group, tree]) => declarations(`--ms-${kebab(group)}`, group, tree as TokenTree));
  return `${HEADER}:root {\n${lines.join('\n')}\n}\n`;
}

function illustrationCss(source: Tokens): string {
  const lines = declarations('--ms-ill', 'illustration', source.illustration);
  const faceRules = ISLAND_MATERIALS.flatMap((material) =>
    ISLAND_FACES.map(
      (face) => `.isl-${material} .${face.slice(0, 1)} {\n  fill: var(--ms-ill-${material}-${face});\n}`,
    ),
  );
  const rules = [
    // The glow reaches past the viewBox; clipping it would leave a hard edge beside the lantern.
    '.isl {\n  overflow: visible;\n}',
    ...faceRules,
    '.isl-post {\n  fill: var(--ms-ill-wood-right);\n}',
    '.isl-shadow {\n  fill: var(--ms-ill-island-shadow);\n}',
    '.isl-stop-core {\n  stop-color: var(--ms-ill-glow-core);\n  stop-opacity: 0.9;\n}',
    '.isl-stop-mid {\n  stop-color: var(--ms-ill-glow-mid);\n  stop-opacity: 0.3;\n}',
    '.isl-stop-edge {\n  stop-color: var(--ms-ill-glow-edge);\n  stop-opacity: 0;\n}',
  ];
  return `${HEADER}:root {\n${lines.join('\n')}\n}\n\n${rules.join('\n\n')}\n`;
}

export function renderTokensCss(part: TokensCssPart, source: Tokens = tokens): string {
  return part === 'core' ? coreCss(source) : illustrationCss(source);
}
