import { describe, expect, it } from 'vitest';
import { appSources } from './appSources';

const RAW_COLOUR = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;

// The CSS named colours (CSS Color 4). transparent, currentColor and the global keywords are allowed.
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod ' +
    'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon ' +
    'darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray ' +
    'dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green ' +
    'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon ' +
    'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon ' +
    'lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy ' +
    'oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred ' +
    'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown ' +
    'salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

// CSS system colours follow the user's forced-colours palette: allowed only inside @media (forced-colors: active).
const SYSTEM_COLOURS = new Set(
  (
    'highlight highlighttext canvastext canvas buttontext buttonface buttonborder linktext graytext field fieldtext ' +
    'mark marktext selecteditem selecteditemtext accentcolor accentcolortext activetext visitedtext'
  ).split(' '),
);

function withoutForcedColours(css: string): string {
  let rest = css;
  for (let start = rest.search(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/); start >= 0;) {
    let depth = 0;
    let end = rest.indexOf('{', start);
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth += 1;
      if (rest[end] === '}' && (depth -= 1) === 0) break;
    }
    rest = rest.slice(0, start) + rest.slice(end + 1);
    start = rest.search(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)\s*\{/);
  }
  return rest;
}

// Properties that take a colour, custom properties included.
const COLOUR_PROPERTY =
  /^(?:--[\w-]+|color|background(?:-color)?|fill|stroke|stop-color|caret-color|accent-color|scrollbar-color|(?:border|outline|column-rule|text-decoration)(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|(?:box|text)-shadow)$/i;

function coloursIn(css: string, names: ReadonlySet<string>): string[] {
  return [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].flatMap(([, property, value]) => {
    if (!COLOUR_PROPERTY.test(property ?? '')) return [];
    const words = (value ?? '').replace(/var\([^)]*\)/g, '').match(/[a-z]+/gi) ?? [];
    return words.filter((word) => names.has(word.toLowerCase())).map((word) => `${property}: ${word}`);
  });
}

function namedColours(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [
    ...coloursIn(withoutComments, NAMED_COLOURS),
    ...coloursIn(withoutForcedColours(withoutComments), SYSTEM_COLOURS),
  ];
}

function rawColours(text: string): string[] {
  return [...(text.replace(/\/\*[\s\S]*?\*\//g, '').match(RAW_COLOUR) ?? []), ...namedColours(text)];
}

describe('the app stylesheet takes its colours from the brand tokens only', () => {
  const css = appSources('.css');

  it('has stylesheets to check', () => {
    expect(css.map((f) => f.path)).toContain('src/app.css');
  });

  it.each(css.map((f) => [f.path, f.text]))('%s has no raw colour', (_path, text) => {
    expect(rawColours(text ?? '')).toEqual([]);
  });

  it.each([
    'color: #fff',
    'fill: #2F4BFF;',
    'rgb(0 0 0)',
    'rgba(0,0,0,.5)',
    'hsl(1 2% 3%)',
    '.x { border: 1px solid black; }',
    'a { color: rebeccapurple; }',
    '.x { background: linear-gradient(90deg, Tomato, transparent); }',
    '.x { outline-color: navy }',
    '.x { box-shadow: 0 0 4px gold; }',
    ':root { --accent: teal; }',
    '.x { outline: 2px solid Highlight; }',
    '@media (forced-colors: none) { .x { color: ButtonText; } }',
    '@media (forced-colors: active) { .a { color: red; } }',
  ])('the matcher catches %s', (sample) => {
    expect(rawColours(sample)).not.toEqual([]);
  });

  it.each([
    'color: var(--ms-color-ink); background: var(--ms-color-paper);',
    '.x { color: currentColor; background: transparent; border-color: inherit; }',
    '/* never white on flash */ .x { fill: none; stroke: currentColor; }',
    '.x { color: var(--c); } @media (forced-colors: active) { .x { outline: 2px solid Highlight; } .y { color: GrayText; } }',
  ])('the matcher accepts %s', (sample) => {
    expect(rawColours(sample)).toEqual([]);
  });
});
