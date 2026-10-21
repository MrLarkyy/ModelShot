import { tokens } from '@modelshot/brand';
import { describe, expect, it } from 'vitest';
import { indexHtml, siteSources } from './siteSources';

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

// Properties that take a colour, custom properties included.
const COLOUR_PROPERTY =
  /^(?:--[\w-]+|color|background(?:-color)?|fill|stroke|stop-color|caret-color|accent-color|scrollbar-color|(?:border|outline|column-rule|text-decoration)(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|(?:box|text)-shadow)$/i;

function namedColours(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].flatMap(([, property, value]) => {
    if (!COLOUR_PROPERTY.test(property!)) return [];
    const words = value!.replace(/var\([^)]*\)/g, '').match(/[a-z]+/gi) ?? [];
    return words.filter((word) => NAMED_COLOURS.has(word.toLowerCase())).map((word) => `${property}: ${word}`);
  });
}

function rawColours(text: string): string[] {
  return [...(text.match(RAW_COLOUR) ?? []), ...namedColours(text)];
}

describe('landing page colours come from tokens only', () => {
  const css = siteSources('.css');

  it('has stylesheets to check', () => {
    expect(css.map((f) => f.path)).toEqual(
      expect.arrayContaining(['src/styles/base.css', 'src/styles/components.css', 'src/styles/motion.css']),
    );
  });

  it.each(css.map((f) => [f.path, f.text]))('%s has no raw colour', (_path, text) => {
    expect(rawColours(text)).toEqual([]);
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
  ])('the matcher catches %s', (sample) => {
    expect(rawColours(sample)).not.toEqual([]);
  });

  it.each([
    'white-space: nowrap; color: var(--ms-color-ink); href="#faq"',
    '.x { color: currentColor; background: transparent; border-color: inherit; outline: 3px solid var(--ring); }',
    '.x { font: var(--ms-weight-bold) 16px var(--ms-font-body); text-align: center; }',
    '/* never white on flash */ .x { fill: none; stroke: currentColor; }',
  ])('the matcher accepts %s', (sample) => {
    expect(rawColours(sample)).toEqual([]);
  });

  it('index.html has no inline styles or colour attributes', () => {
    const html = indexHtml();
    expect(html).not.toMatch(/\sstyle=|<style|\s(?:fill|stroke|color|bgcolor)="/i);
  });

  it('the theme colour is the cloud token, the only colour in index.html', () => {
    const html = indexHtml();
    expect(html).toContain(`<meta name="theme-color" content="${tokens.color.cloud}" />`);
    const colours = html.replace(`content="${tokens.color.cloud}"`, '').match(/["'(\s:]#[\da-f]{3,8}["');\s]/gi);
    expect(colours).toBeNull();
  });
});
