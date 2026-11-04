import type { Direction } from '@modelshot/looks';
import type { LookPreset } from '@modelshot/looks';
import { el } from '../ui/dom';

const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const triple = (v: readonly number[]): string => v.map((n) => fixed(n)).join(', ');

function section(title: string, rows: readonly (readonly [string, string])[]): HTMLElement {
  return el('section', { attributes: { 'aria-label': title } }, [
    el('h3', { text: title }),
    el(
      'dl',
      {},
      rows.flatMap(([term, value]) => [el('dt', { text: term }), el('dd', { text: value })]),
    ),
  ]);
}

const direction = (d: Direction): string => triple(d);

// The Light tab: the key and rim light of the look, read-only. Placing more lights comes later.
export function buildLightTab(look: LookPreset, focus: 'key' | 'rim' | null): HTMLElement[] {
  const { key, rim } = look.lights;
  const add = el('button', { text: 'Add light', attributes: { type: 'button', disabled: '' } });
  const sections = [
    section('Key light', [
      ['Direction', direction(key.direction)],
      ['Colour', triple(key.color)],
      ['Softness', fixed(key.angularRadius, 3)],
    ]),
    section('Rim light', [
      ['Direction', direction(rim.direction)],
      ['Colour', triple(rim.color)],
      ['Falloff', fixed(rim.exponent, 1)],
      ['Albedo share', fixed(rim.albedoShare)],
    ]),
  ];
  if (focus === 'rim') sections.reverse();
  return [
    el('p', { className: 'hint', text: `Lights of the ${look.name} look. Choose another look to change them.` }),
    ...sections,
    add,
    el('p', { className: 'hint', text: 'Adding lights is not available yet.' }),
  ];
}
