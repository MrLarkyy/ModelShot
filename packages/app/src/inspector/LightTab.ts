import type { Direction, LookPreset, Rgb } from '@modelshot/looks';
import { el } from '../ui/dom';

/** One read-only group of the Light tab: a title and term / value rows. */
export interface LightSection {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const triple = (v: Direction | Rgb): string => v.map((n) => fixed(n)).join(', ');
// A black light adds nothing: the look is lit by its other lights or its environment.
const colour = (c: Rgb): string => (c.every((v) => v === 0) ? 'Off (0, 0, 0)' : triple(c));

/** The lights of `look` as it defines them: key, fill and rim, then the environment that lights from every side. */
export function lightSections(look: LookPreset): LightSection[] {
  const { key, fill, rim } = look.lights;
  const env = look.environment;
  return [
    {
      title: 'Key light',
      rows: [
        ['Direction', triple(key.direction)],
        ['Colour', colour(key.color)],
        ['Softness', fixed(key.angularRadius, 3)],
      ],
    },
    {
      title: 'Fill light',
      rows: [
        ['Direction', triple(fill.direction)],
        ['Colour', colour(fill.color)],
      ],
    },
    {
      title: 'Rim light',
      rows: [
        ['Direction', triple(rim.direction)],
        ['Colour', colour(rim.color)],
        ['Falloff', fixed(rim.exponent, 1)],
        ['Albedo share', fixed(rim.albedoShare)],
      ],
    },
    {
      title: 'Environment',
      rows:
        env.kind === 'hdri'
          ? [
              ['Kind', 'Image (HDRI)'],
              ['Image', env.image],
              ['Intensity', fixed(env.intensity)],
              ['Rotation', `${fixed(env.rotationDeg, 0)}°`],
            ]
          : [
              ['Kind', 'Sky and ground dome'],
              ['Sky', triple(env.sky)],
              ['Ground', triple(env.ground)],
            ],
    },
  ];
}

function section({ title, rows }: LightSection): HTMLElement {
  return el('section', { attributes: { 'aria-label': title } }, [
    el('h3', { text: title }),
    el(
      'dl',
      {},
      rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]),
    ),
  ]);
}

// The Light tab: the lights of the look, read-only; the one picked in the outliner first. Placing more lights comes
// later.
export function buildLightTab(look: LookPreset, focus: 'key' | 'rim' | null): HTMLElement[] {
  const sections = lightSections(look);
  const first = focus === 'rim' ? sections.findIndex((s) => s.title === 'Rim light') : -1;
  if (first > 0) sections.unshift(...sections.splice(first, 1));
  const add = el('button', { text: 'Add light', attributes: { type: 'button', disabled: '' } });
  return [
    el('p', { className: 'hint', text: `Lights of the ${look.name} look. Choose another look to change them.` }),
    ...sections.map(section),
    add,
    el('p', { className: 'hint', text: 'Adding lights is not available yet.' }),
  ];
}
