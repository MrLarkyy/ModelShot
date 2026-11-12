import type { Direction, LookPreset, Rgb } from '@modelshot/looks';
import { el } from '../ui/dom';
import { section } from '../ui/section';
import type { SectionId, SectionState } from '../ui/sectionState';
import { lightAim, lightHex, lightIntensity, softnessDegrees, type LightAim } from './lightValues';

export type LightId = 'key' | 'fill' | 'rim' | 'environment';

/** One group of the Light tab: a title and term / value rows, read-only (the look defines them). */
export interface LightSection {
  readonly id: LightId;
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  /** The light's colour as `#RRGGBB`; null for an unlit light or the environment. */
  readonly swatch: string | null;
  /** Where the light points; null for the environment. */
  readonly aim: LightAim | null;
}

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const triple = (v: Direction | Rgb): string => v.map((n) => fixed(n)).join(', ');
const degrees = (value: number): string => `${Math.round(value)}°`;

// A black light adds nothing: the look is lit by its other lights or its environment.
function colourRows(color: Rgb): (readonly [string, string])[] {
  const hex = lightHex(color);
  return hex === null
    ? [
        ['Colour', 'Off'],
        ['Intensity', '0.00'],
      ]
    : [
        ['Colour', hex],
        ['Intensity', fixed(lightIntensity(color))],
      ];
}

const AZIMUTH_TITLE =
  "0° is toward the camera (the Front view's for key and fill, the live view's for rim), positive to the viewer's right, ±180° behind the model";

function aimRows(aim: LightAim): (readonly [string, string])[] {
  return [
    ['Azimuth', degrees(aim.azimuth)],
    ['Elevation', degrees(aim.elevation)],
  ];
}

/** The lights of `look` as it defines them: key, fill and rim, then the environment that lights from every side. */
export function lightSections(look: LookPreset): LightSection[] {
  const { key, fill, rim } = look.lights;
  const env = look.environment;
  const keyAim = lightAim(key.direction);
  const fillAim = lightAim(fill.direction);
  const rimAim = lightAim(rim.direction, 'view');
  return [
    {
      id: 'key',
      title: 'Key light',
      rows: [
        ...colourRows(key.color),
        ['Softness', `${fixed(softnessDegrees(key.angularRadius), 1)}°`],
        ...aimRows(keyAim),
      ],
      swatch: lightHex(key.color),
      aim: keyAim,
    },
    {
      id: 'fill',
      title: 'Fill light',
      rows: [...colourRows(fill.color), ...aimRows(fillAim)],
      swatch: lightHex(fill.color),
      aim: fillAim,
    },
    {
      id: 'rim',
      title: 'Rim light',
      rows: [
        ...colourRows(rim.color),
        ...aimRows(rimAim),
        ['Falloff', fixed(rim.exponent, 1)],
        ['Albedo share', fixed(rim.albedoShare)],
      ],
      swatch: lightHex(rim.color),
      aim: rimAim,
    },
    {
      id: 'environment',
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
      swatch: null,
      aim: null,
    },
  ];
}

/** Which lights make shadows in the preview and the render: the key (with the shadow catcher); fill and rim never do. */
export function shadowRows(look: LookPreset): (readonly [string, string])[] {
  return [
    ['Key light', 'Yes'],
    ['Fill light', 'No'],
    ['Rim light', 'No'],
    ['Shadow catcher', `${Math.round(look.catcher.strength * 100)} % dark`],
  ];
}

const SECTION_IDS: Readonly<Record<LightId, SectionId>> = {
  key: 'light-key',
  fill: 'light-fill',
  rim: 'light-rim',
  environment: 'light-environment',
};

const SVG = 'http://www.w3.org/2000/svg';
const DIAL = 56;

// A top view of where a light stands: the model is the centre, the camera side is down, a nearer-the-horizon light sits
// nearer the rim of the circle. The numbers beside it say the same in words.
function dial(aim: LightAim): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${DIAL} ${DIAL}`);
  svg.setAttribute('width', String(DIAL));
  svg.setAttribute('height', String(DIAL));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'light-dial');
  const centre = DIAL / 2;
  const reach = centre - 6;
  const ring = document.createElementNS(SVG, 'circle');
  ring.setAttribute('cx', String(centre));
  ring.setAttribute('cy', String(centre));
  ring.setAttribute('r', String(reach));
  ring.setAttribute('class', 'dial-ring');
  const radians = Math.PI / 180;
  const spread = Math.cos(aim.elevation * radians) * reach;
  const dot = document.createElementNS(SVG, 'circle');
  dot.setAttribute('cx', (centre + Math.sin(aim.azimuth * radians) * spread).toFixed(2));
  dot.setAttribute('cy', (centre + Math.cos(aim.azimuth * radians) * spread).toFixed(2));
  dot.setAttribute('r', '4');
  dot.setAttribute('class', 'dial-dot');
  svg.append(ring, dot);
  return svg;
}

function swatch(hex: string | null): HTMLElement {
  const chip = el('span', { className: 'swatch', attributes: { 'aria-hidden': 'true' } });
  if (hex) chip.style.setProperty('background-color', hex);
  else chip.classList.add('off');
  return chip;
}

function rows(entries: readonly (readonly [string, string])[], hex: string | null = null): HTMLElement {
  return el(
    'dl',
    { className: 'value-grid' },
    entries.flatMap(([term, value]) => [
      el('dt', term === 'Azimuth' ? { text: term, attributes: { title: AZIMUTH_TITLE } } : { text: term }),
      el('dd', {}, term === 'Colour' ? [swatch(hex), el('span', { text: value })] : [value]),
    ]),
  );
}

const AIM_TERMS: readonly string[] = ['Azimuth', 'Elevation'];

// The dial stands beside the two angles it draws; the other rows keep the full width, so a colour is never cut off.
function lightBody(entry: LightSection): HTMLElement[] {
  if (!entry.aim) return [rows(entry.rows)];
  return [
    rows(
      entry.rows.filter(([term]) => !AIM_TERMS.includes(term)),
      entry.swatch,
    ),
    el('div', { className: 'light-aim' }, [
      dial(entry.aim),
      rows(entry.rows.filter(([term]) => AIM_TERMS.includes(term))),
    ]),
  ];
}

// The Light tab: the lights of the look, read-only; the one picked in the outliner first. The look defines the lights,
// so there is nothing to place here.
export function buildLightTab(look: LookPreset, focus: 'key' | 'rim' | null, sections: SectionState): HTMLElement[] {
  const entries = lightSections(look);
  const first = focus === 'rim' ? entries.findIndex((s) => s.id === 'rim') : -1;
  if (first > 0) entries.unshift(...entries.splice(first, 1));
  const built = new Map<LightId, HTMLElement>(
    entries.map((entry) => [entry.id, section(SECTION_IDS[entry.id], entry.title, lightBody(entry), sections)]),
  );
  const heads = (id: LightId): HTMLElement | null => built.get(id)?.querySelector<HTMLElement>('button') ?? null;
  const others = entries.filter((entry) => entry.id !== 'environment' && entry.id !== entries[0]?.id);
  const jump = (id: LightId): void => {
    const head = heads(id);
    if (!head) return;
    if (head.getAttribute('aria-expanded') !== 'true') head.click();
    head.focus();
  };
  const list = others.map((entry) => {
    const button = el(
      'button',
      { className: 'ghost', attributes: { type: 'button', 'data-focus': `light:${entry.id}` } },
      [swatch(entry.swatch), el('span', { text: entry.title })],
    );
    button.addEventListener('click', () => jump(entry.id));
    return button;
  });
  return [
    el('p', { className: 'hint', text: `Lights come from the ${look.name} look. Choose another look in Look.` }),
    ...entries.map((entry) => built.get(entry.id) as HTMLElement),
    section('light-shadows', 'Shadows', [rows(shadowRows(look))], sections),
    section('light-others', 'Other lights', [el('div', { className: 'button-row' }, list)], sections),
  ];
}
