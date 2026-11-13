import { afterEach, describe, expect, it, vi } from 'vitest';
import { iconButton } from '../src/ui/iconButton';
import { FakeNode, stubSvgDocument } from './fakeSvgDocument';

const make = (...args: Parameters<typeof iconButton>): FakeNode => iconButton(...args) as unknown as FakeNode;

describe('iconButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the button by its label and hides the drawing from assistive tech', () => {
    stubSvgDocument();
    const button = make('eye', 'Visible');
    expect(button.tag).toBe('button');
    expect(button.type).toBe('button');
    expect(button.className).toBe('icon-button');
    expect(button.getAttribute('aria-label')).toBe('Visible');
    expect(button.title).toBe('Visible');
    expect(button.getAttribute('aria-pressed')).toBeNull();
    expect(button.children).toHaveLength(1);
    expect(button.children[0]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the small size is a 26 px button holding the 14 px icon', () => {
    stubSvgDocument();
    const button = make('lock', 'Locked', { small: true });
    expect(button.className).toBe('icon-button small');
    expect(button.children[0]?.getAttribute('width')).toBe('14');
  });

  it('a toggle states its pressed value', () => {
    stubSvgDocument();
    expect(make('eye', 'Visible', { pressed: true }).getAttribute('aria-pressed')).toBe('true');
    expect(make('eye', 'Visible', { pressed: false }).getAttribute('aria-pressed')).toBe('false');
  });

  it('a shortcut goes into the tooltip and aria-keyshortcuts, the name stays the label', () => {
    stubSvgDocument();
    const button = make('undo', 'Undo', { shortcut: 'undo' });
    expect(button.getAttribute('aria-label')).toBe('Undo');
    expect(button.title).toBe('Undo (Ctrl+Z / Cmd+Z)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+Z Meta+Z');
    const redo = make('redo', 'Redo', { shortcut: 'redo' });
    expect(redo.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Z Meta+Shift+Z Control+Y');
    expect(make('eye', 'Visible').getAttribute('aria-keyshortcuts')).toBeNull();
  });

  it('refuses an empty label', () => {
    stubSvgDocument();
    expect(() => iconButton('eye', ' ')).toThrow(/needs a label/);
  });
});
