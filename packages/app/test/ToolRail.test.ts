import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRail } from '../src/viewport/ToolRail';
import { stubTimelineDom, TimelineElement } from './fakeTimelineDom';

describe('ToolRail', () => {
  beforeEach(() => stubTimelineDom());
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const root = new TimelineElement();
    const select = vi.fn();
    const rail = new ToolRail(root as unknown as HTMLElement, select);
    const [move, rotate] = root.children;
    if (!move || !rotate) throw new Error('two buttons');
    return { rail, select, move, rotate };
  }

  it('has a Move and a Rotate button with their keys, off until enabled, Move pressed', () => {
    const { rail, move, rotate } = setup();
    expect(move.getAttribute('aria-label')).toBe('Move');
    expect(move.title).toBe('Move (W)');
    expect(move.getAttribute('aria-keyshortcuts')).toBe('W');
    expect(rotate.getAttribute('aria-keyshortcuts')).toBe('E');
    expect([move.disabled, rotate.disabled]).toEqual([true, true]);
    expect(move.getAttribute('aria-pressed')).toBe('true');
    rail.setEnabled(true);
    expect(move.disabled).toBe(false);
  });

  it('a click chooses the mode, and the pressed button follows setMode whoever chose it', () => {
    const { rail, select, move, rotate } = setup();
    rotate.fire('click');
    expect(select).toHaveBeenCalledWith('rotate');
    rail.setMode('rotate');
    expect(rotate.getAttribute('aria-pressed')).toBe('true');
    expect(move.getAttribute('aria-pressed')).toBe('false');
  });
});
