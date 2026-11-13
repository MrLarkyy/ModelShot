import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpDialog } from '../src/shortcuts/HelpDialog';
import { SHORTCUTS } from '../src/shortcuts/shortcutAction';
import { stubTimelineDom, TimelineElement } from './fakeTimelineDom';

type Dialog = TimelineElement & { open: boolean; showModal: () => void; close: () => void };

function setup() {
  const dialog = new TimelineElement('dialog') as Dialog;
  dialog.open = false;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.fire('close');
  };
  const help = new HelpDialog(dialog as unknown as HTMLDialogElement);
  return { dialog, help };
}

const rowsOf = (dialog: TimelineElement) => dialog.all((e) => e.getAttribute('data-action') !== null);

describe('HelpDialog', () => {
  beforeEach(() => {
    stubTimelineDom();
    vi.stubGlobal('document', {
      ...(globalThis.document as object),
      createElement: (tag: string) => new TimelineElement(tag),
      createElementNS: () => new TimelineElement('svg'),
      activeElement: null,
      body: {},
      getElementById: () => null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists exactly the bound shortcuts: a missing or an unbound one fails here', () => {
    const { dialog } = setup();
    const listed = rowsOf(dialog).map((row) => row.getAttribute('data-action'));
    expect(listed.sort()).toEqual(SHORTCUTS.map((s) => s.action).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('shows a keycap per key of every binding', () => {
    const { dialog } = setup();
    const redo = rowsOf(dialog).find((row) => row.getAttribute('data-action') === 'redo');
    const keys = redo?.byClass('keycap').map((cap) => cap.textContent);
    expect(keys).toEqual(['Ctrl', 'Shift', 'Z', 'Ctrl', 'Y']);
  });

  it('lists the keys of the 3D view and of the scrubber in their own groups', () => {
    const { dialog } = setup();
    expect(dialog.all((e) => e.getAttribute('data-list') === 'orbit').length).toBeGreaterThan(3);
    expect(dialog.all((e) => e.getAttribute('data-list') === 'scrubber').length).toBeGreaterThan(3);
  });

  it('filters rows and groups by label or key, and says when nothing matches', () => {
    const { dialog, help } = setup();
    help.open();
    const search = dialog.byClass('help-search')[0]!;
    const none = dialog.byClass('help-none')[0] as unknown as { hidden: boolean };
    const hidden = (): number =>
      dialog.byClass('help-row').filter((row) => (row as unknown as { hidden: boolean }).hidden).length;
    expect(hidden()).toBe(0);
    search.value = 'keyframe';
    search.fire('input');
    expect(
      dialog.byClass('help-row').filter((row) => !(row as unknown as { hidden: boolean }).hidden).length,
    ).toBeGreaterThanOrEqual(2);
    expect(none.hidden).toBe(true);
    search.value = 'zzzz';
    search.fire('input');
    expect(none.hidden).toBe(false);
    search.value = '';
    search.fire('input');
    expect(hidden()).toBe(0);
  });

  it('opens once, closes, and puts the focus back on the Help button when the opener is gone', () => {
    const { dialog, help } = setup();
    const opener = new TimelineElement('button');
    const helpButton = new TimelineElement('button');
    const focused: string[] = [];
    helpButton.focus = () => focused.push('help');
    vi.stubGlobal('HTMLElement', TimelineElement);
    vi.stubGlobal('document', {
      createElement: (tag: string) => new TimelineElement(tag),
      createElementNS: () => new TimelineElement('svg'),
      activeElement: opener,
      body: {},
      getElementById: (id: string) => (id === 'help-open' ? helpButton : null),
    });
    help.open();
    help.open();
    expect(dialog.open).toBe(true);
    help.close();
    expect(dialog.open).toBe(false);
    expect(focused).toEqual(['help']);
  });
});
