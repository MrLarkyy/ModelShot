import { LOOK_PRESETS } from '@modelshot/looks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLightTab, lightSections } from '../src/inspector/LightTab';

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
    expect(softbox['Rim light']?.['Colour']).toBe('Off (0, 0, 0)');
    expect(softbox['Fill light']?.['Colour']).toBe('Off (0, 0, 0)');
    expect(softbox['Key light']?.['Colour']).toBe('0.80, 0.76, 0.70');
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
});

// Just enough of an element for `el`: its tag, text and children.
interface FakeNode {
  readonly tag: string;
  textContent: string;
  readonly children: FakeNode[];
}

function stubDocument(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const node = { tag, textContent: '', children: [] as FakeNode[] };
      return { ...node, setAttribute: () => undefined, append: (...c: FakeNode[]) => node.children.push(...c) };
    },
  });
}

// The h3 titles of the tab's sections, in the order shown.
const titles = (focus: 'key' | 'rim' | null): string[] =>
  (buildLightTab(LOOK_PRESETS['studio']!, focus) as unknown as FakeNode[])
    .filter((e) => e.tag === 'section')
    .map((e) => e.children.find((c) => c.tag === 'h3')?.textContent ?? '');

describe('buildLightTab', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the rim light first when it was picked, the others in their defined order', () => {
    stubDocument();
    expect(titles('rim')).toEqual(['Rim light', 'Key light', 'Fill light', 'Environment']);
  });

  it('keeps the defined order for the key light or no pick', () => {
    stubDocument();
    expect(titles('key')).toEqual(['Key light', 'Fill light', 'Rim light', 'Environment']);
    expect(titles(null)).toEqual(['Key light', 'Fill light', 'Rim light', 'Environment']);
  });
});
