import { afterEach, describe, expect, it, vi } from 'vitest';
import { ICON_NAMES, icon, type IconName } from '../src/ui/icon';
import { FakeNode, stubSvgDocument } from './fakeSvgDocument';

const SHAPES = new Set(['path', 'circle', 'rect', 'line', 'polyline']);
const PATH_GRAMMAR = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

const draw = (name: IconName, size?: 16 | 14): FakeNode => icon(name, size ? { size } : {}) as unknown as FakeNode;

const fingerprint = (node: FakeNode): string =>
  node.children.map((child) => `${child.tag}:${[...child.attributes.entries()].join(',')}`).join('|');

describe('icon', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds the icons the editor asks for', () => {
    expect([...ICON_NAMES].sort()).toEqual(
      [
        'eye',
        'lock',
        'chevron-down',
        'chevron-right',
        'chevron-left',
        'chevron-up',
        'plus',
        'undo',
        'redo',
        'search',
        'cube',
        'sun',
        'camera',
        'play',
        'loop',
        'frame',
        'share',
        'download',
        'more',
        'panel-left',
        'panel-right',
        'panel-bottom',
        'close',
        'eye-off',
        'unlock',
        'material',
        'look',
        'render',
        'keyframe',
        'folder',
        'check',
        'pause',
        'skip-start',
        'key-prev',
        'key-next',
        'move',
        'rotate',
        'help',
        'zoom-in',
        'zoom-out',
      ].sort(),
    );
  });

  it.each(ICON_NAMES)('draws %s as a decorative 16 grid svg', (name) => {
    stubSvgDocument();
    const svg = draw(name);
    expect(svg.namespace).toBe('http://www.w3.org/2000/svg');
    expect(svg.tag).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.className).toBe('icon');
    expect(svg.children.length).toBeGreaterThan(0);
    for (const child of svg.children) {
      expect(SHAPES.has(child.tag)).toBe(true);
      expect(child.namespace).toBe('http://www.w3.org/2000/svg');
      const d = child.getAttribute('d');
      if (d !== null) expect(d).toMatch(PATH_GRAMMAR);
    }
  });

  it('draws every icon differently', () => {
    stubSvgDocument();
    const prints = ICON_NAMES.map((name) => fingerprint(draw(name)));
    expect(new Set(prints).size).toBe(ICON_NAMES.length);
  });

  it('draws the 14 px size on the same grid', () => {
    stubSvgDocument();
    const svg = draw('cube', 14);
    expect(svg.getAttribute('width')).toBe('14');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.className).toBe('icon small');
  });

  it('refuses a name it does not have', () => {
    stubSvgDocument();
    expect(() => icon('trash' as IconName)).toThrow(/Unknown icon "trash"/);
  });
});
