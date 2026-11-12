import { LOOK_PRESETS } from '@modelshot/looks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLightTab, lightSections, shadowRows } from '../src/inspector/LightTab';
import { lightAim, lightHex, lightIntensity, softnessDegrees } from '../src/inspector/lightValues';
import { SectionState } from '../src/ui/sectionState';
import { FakeElement, stubDom } from './fakeDom';

const rows = (id: string): Record<string, Record<string, string>> =>
  Object.fromEntries(lightSections(LOOK_PRESETS[id]!).map((s) => [s.title, Object.fromEntries(s.rows)]));

describe('lightSections', () => {
  it('describes Softbox as its data lights it: the environment image and the key, fill and rim off', () => {
    const softbox = rows('softbox');
    expect(Object.keys(softbox)).toEqual(['Key light', 'Fill light', 'Rim light', 'Environment']);
    expect(softbox['Environment']).toEqual({
      Kind: 'Image (HDRI)',
      Image: 'softbox-studio',
      Intensity: '1.00',
      Rotation: '0°',
    });
    expect(softbox['Rim light']?.['Colour']).toBe('Off');
    expect(softbox['Rim light']?.['Intensity']).toBe('0.00');
    expect(softbox['Fill light']?.['Colour']).toBe('Off');
    expect(softbox['Key light']?.['Intensity']).toBe('0.80');
    expect(softbox['Key light']?.['Colour']).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('gives the Studio key its colour, intensity, softness and aim', () => {
    const key = rows('studio')['Key light'];
    expect(key).toEqual({
      Colour: '#FFFCF9',
      Intensity: '1.25',
      Softness: '2.3°',
      Azimuth: '-139°',
      Elevation: '53°',
    });
  });

  it('describes a dome look by its sky and ground', () => {
    for (const look of Object.values(LOOK_PRESETS)) {
      const env = Object.fromEntries(lightSections(look).find((s) => s.title === 'Environment')!.rows);
      if (look.environment.kind === 'dome') {
        expect(env['Kind']).toBe('Sky and ground dome');
        expect(env['Sky']).toBe(look.environment.sky.map((v) => v.toFixed(2)).join(', '));
      } else {
        expect(env['Image']).toBe(look.environment.image);
      }
    }
  });

  it('says which lights cast shadows', () => {
    expect(shadowRows(LOOK_PRESETS['studio']!)).toEqual([
      ['Key light', 'Yes'],
      ['Fill light', 'No'],
      ['Rim light', 'No'],
      ['Shadow catcher', '100 % dark'],
    ]);
  });
});

describe('lightValues', () => {
  it('encodes the hue at full strength and reads the intensity as the strongest channel', () => {
    expect(lightHex([2, 1, 0])).toBe('#FFBC00');
    expect(lightIntensity([2, 1, 0])).toBe(2);
    expect(lightHex([0, 0, 0])).toBeNull();
  });

  it('turns a direction into azimuth and elevation', () => {
    // The Front preset's camera stands at -z, and the viewer's right there is world -x.
    const toward = lightAim([0, 0, -1]);
    expect(toward.azimuth).toBeCloseTo(0);
    expect(toward.elevation).toBeCloseTo(0);
    expect(lightAim([-1, 0, 0]).azimuth).toBeCloseTo(90);
    expect(Math.abs(lightAim([0, 0, 1]).azimuth)).toBeCloseTo(180);
    // The rim is in view space: z toward the camera, x right.
    expect(lightAim([0, 0, 1], 'view').azimuth).toBeCloseTo(0);
    expect(lightAim([1, 0, 0], 'view').azimuth).toBeCloseTo(90);
    expect(lightAim([0, 1, 0]).elevation).toBeCloseTo(90);
    expect(softnessDegrees(Math.PI / 2)).toBeCloseTo(90);
  });
});

// The titles of the tab's sections, in the order shown.
const titles = (focus: 'key' | 'rim' | null): string[] =>
  (buildLightTab(LOOK_PRESETS['studio']!, focus, new SectionState(null)) as unknown as FakeElement[])
    .filter((e) => e.className === 'section')
    .map((e) => (e.children[0] as FakeElement).textContent);

describe('buildLightTab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the rim light first when it was picked, the others in their defined order', () => {
    stubDom();
    expect(titles('rim')).toEqual(['Rim light', 'Key light', 'Fill light', 'Environment', 'Shadows', 'Other lights']);
  });

  it('keeps the defined order for the key light or no pick', () => {
    stubDom();
    const expected = ['Key light', 'Fill light', 'Rim light', 'Environment', 'Shadows', 'Other lights'];
    expect(titles('key')).toEqual(expected);
    expect(titles(null)).toEqual(expected);
  });

  it('has no placeholder control for adding a light', () => {
    stubDom();
    const tab = buildLightTab(LOOK_PRESETS['studio']!, null, new SectionState(null)) as unknown as FakeElement[];
    const text = tab.map((e) => e.textContent).join(' ');
    expect(text).not.toMatch(/Add light|not available yet/);
    expect(text).toContain('Lights come from the Studio look. Choose another look in Look.');
  });

  it('lists the lights other than the first as buttons that move focus to their section', () => {
    stubDom();
    const tab = buildLightTab(LOOK_PRESETS['studio']!, 'rim', new SectionState(null)) as unknown as FakeElement[];
    const others = tab.at(-1) as FakeElement;
    const buttons = others.find(
      (e) => e.tagName === 'button' && e.getAttribute('data-focus')?.startsWith('light:') === true,
    );
    expect(buttons.map((b) => b.textContent)).toEqual(['Key light', 'Fill light']);
    buttons[1]?.dispatch('click');
    const fill = tab.find(
      (e) => e.className === 'section' && (e.children[0] as FakeElement).textContent === 'Fill light',
    );
    expect((fill?.children[0] as FakeElement).focused).toBe(true);
  });
});
