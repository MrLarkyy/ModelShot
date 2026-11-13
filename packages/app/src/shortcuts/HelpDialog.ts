import { el } from '../ui/dom';
import { iconButton } from '../ui/iconButton';
import { SCRUBBER_KEYS } from '../timeline/scrubberKeyList';
import { keycaps, keyNames } from './keycaps';
import { parseKeys, type ListedKeys } from './listedKeys';
import { ORBIT_KEYS } from './orbitKeys';
import { SHORTCUTS, type ShortcutGroup } from './shortcutAction';

const GROUPS: readonly ShortcutGroup[] = ['File', 'View', 'Selection', 'Timeline'];

interface Row {
  readonly element: HTMLElement;
  /** What a search matches: the label and the keys. */
  readonly text: string;
}

interface Section {
  readonly element: HTMLElement;
  readonly rows: readonly Row[];
}

function listedRow(entry: ListedKeys, kind: string): Row {
  const caps = el(
    'span',
    { className: 'help-keys' },
    parseKeys(entry.keys).flatMap((alternative, index) => [
      ...(index > 0 ? [el('span', { className: 'help-or', text: 'or' })] : []),
      el(
        'span',
        { className: 'keycaps' },
        alternative.map((name) => el('kbd', { className: 'keycap', text: name })),
      ),
    ]),
  );
  const element = el('li', { className: 'help-row', attributes: { 'data-list': kind } }, [
    el('span', { className: 'help-label', text: entry.label }),
    caps,
  ]);
  return { element, text: `${entry.label} ${entry.keys}`.toLowerCase() };
}

function section(title: string, rows: readonly Row[]): Section {
  const element = el('section', { className: 'help-group' }, [
    el('h3', { text: title }),
    el(
      'ul',
      { className: 'help-list' },
      rows.map((row) => row.element),
    ),
  ]);
  return { element, rows };
}

// The shortcut list in a native dialog: a header with the search field first, so it takes the focus, and a body that
// scrolls. Every row of the document-wide shortcuts is `data-action`, built from `SHORTCUTS`; the keys of the 3D view and
// of the focused scrubber have their own groups.
export class HelpDialog {
  private readonly search: HTMLInputElement;
  private readonly sections: readonly Section[];
  private readonly none: HTMLElement;
  private opener: HTMLElement | null = null;
  private owesFocus = false;

  constructor(private readonly dialog: HTMLDialogElement) {
    this.search = el('input', {
      className: 'help-search',
      attributes: {
        type: 'search',
        'aria-label': 'Search shortcuts',
        placeholder: 'Search shortcuts',
        autocomplete: 'off',
      },
    });
    this.search.addEventListener('input', () => this.filter());
    const close = iconButton('close', 'Close');
    close.addEventListener('click', () => this.close());
    const documentWide = GROUPS.map((group) =>
      section(
        group,
        SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => {
          const caps = el(
            'span',
            { className: 'help-keys' },
            shortcut.bindings.flatMap((binding, index) => [
              ...(index > 0 ? [el('span', { className: 'help-or', text: 'or' })] : []),
              keycaps(binding),
            ]),
          );
          const element = el('li', { className: 'help-row', attributes: { 'data-action': shortcut.action } }, [
            el('span', { className: 'help-label', text: shortcut.label }),
            caps,
          ]);
          const text = `${shortcut.label} ${shortcut.bindings.map((b) => keyNames(b).join('+')).join(' ')} ${shortcut.keys}`;
          return { element, text: text.toLowerCase() };
        }),
      ),
    );
    this.sections = [
      ...documentWide,
      section(
        'In the 3D view',
        ORBIT_KEYS.map((entry) => listedRow(entry, 'orbit')),
      ),
      section(
        'On the timeline scrubber',
        SCRUBBER_KEYS.map((entry) => listedRow(entry, 'scrubber')),
      ),
    ];
    this.none = el('p', { className: 'hint help-none', text: 'No shortcut matches.', attributes: { hidden: '' } });
    dialog.replaceChildren(
      el('div', { className: 'help-head' }, [
        el('h2', { id: 'help-title', text: 'Keyboard shortcuts' }),
        this.search,
        close,
      ]),
      el(
        'div',
        { className: 'help-body', attributes: { tabindex: '0', role: 'region', 'aria-label': 'Shortcut list' } },
        [...this.sections.map((s) => s.element), this.none],
      ),
    );
    // The search field would take Escape for clearing itself: Escape always closes, at once.
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      this.close();
    });
    dialog.addEventListener('close', () => this.returnFocus());
  }

  open(): void {
    if (this.dialog.open) return;
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    this.owesFocus = true;
    this.search.value = '';
    this.filter();
    this.dialog.showModal();
    this.search.focus();
  }

  close(): void {
    if (!this.dialog.open) return;
    this.dialog.close();
    // At once, not on the close event: the next key must not land on the field of a dialog that is gone.
    this.returnFocus();
  }

  private filter(): void {
    const words = this.search.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const group of this.sections) {
      let any = false;
      for (const row of group.rows) {
        const match = words.every((word) => row.text.includes(word));
        row.element.hidden = !match;
        any ||= match;
        if (match) shown++;
      }
      group.element.hidden = !any;
    }
    this.none.hidden = shown > 0;
  }

  // The opener when it can still be seen; else the Help button (the File menu hides with its item).
  private returnFocus(): void {
    if (!this.owesFocus) return;
    this.owesFocus = false;
    const opener = this.opener;
    this.opener = null;
    if (!opener) {
      // Nothing had the focus: the search field must not keep it, or the keys would count as typing.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return;
    }
    const visible = opener.isConnected && opener.getClientRects().length > 0;
    (visible ? opener : document.getElementById('help-open'))?.focus();
  }
}
