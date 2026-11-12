import type { SceneDocument } from '@modelshot/scene';
import { displayName, MAX_NAME_LENGTH } from '../editor/displayName';
import type { Selection, SelectionTarget } from '../editor/Selection';
import { bindDisclosure } from '../ui/bindDisclosure';
import { el, uniqueId } from '../ui/dom';
import { icon } from '../ui/icon';
import { iconButton } from '../ui/iconButton';
import { countCubes, MAX_SCENE_ROWS, outlinerRows, type OutlinerRow } from './outlinerTree';

export { MAX_SCENE_ROWS };

export interface ScenePanelHost {
  readonly setNodeVisible: (index: number, visible: boolean) => void;
  readonly setMeshVisible: (index: number, visible: boolean) => void;
  readonly selectRow: (kind: 'node' | 'mesh', index: number) => void;
  readonly setLocked: (kind: 'node' | 'mesh', index: number, locked: boolean) => void;
  /** Gives a node or element a label; an empty one takes the file's name back. */
  readonly rename: (kind: 'node' | 'mesh', index: number, name: string) => void;
  readonly selectLight: (light: 'key' | 'rim') => void;
  readonly openFiles: () => void;
  /** The user opened or closed groups: the indices of the collapsed ones, to keep with the model. */
  readonly collapseChanged?: (collapsed: readonly number[]) => void;
}

export interface ScenePanelModel {
  readonly doc: SceneDocument;
  readonly nodeVisible: readonly boolean[];
  readonly meshVisible: readonly boolean[];
  readonly lockedNodes: readonly boolean[];
  readonly lockedMeshes: readonly boolean[];
  readonly names: ReadonlyMap<string, string>;
}

const ADD_LIGHT_LABEL = 'Add light (coming with user-placed lights)';
const SEARCH_MAX = 128;

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

// A label with the searched parts in <mark>: text nodes only, so a name can never become markup.
function labelNodes(name: string, row: OutlinerRow): (Node | string)[] {
  if (row.matchRanges.length === 0) return [name];
  const parts: (Node | string)[] = [];
  let at = 0;
  for (const [start, end] of row.matchRanges) {
    if (start > at) parts.push(name.slice(at, start));
    parts.push(el('mark', { text: name.slice(start, end) }));
    at = end;
  }
  if (at < name.length) parts.push(name.slice(at));
  return parts;
}

// The outliner: the nodes (groups) and meshes (elements) of the open model as a tree with select, rename, hide, lock,
// collapse and search, and the look's lights. Names come from the file or the user and are set as text only. One tab stop
// on the tree (arrow keys move through it); the row's buttons are reachable from the row that has it.
export class ScenePanel {
  private model: ScenePanelModel | null = null;
  private selected: SelectionTarget | null = null;
  private collapsed = new Set<number>();
  private current: string | null = null;
  private lights: { readonly key: string | null; readonly rim: string | null } = { key: null, rim: null };
  private readonly items = new Map<string, HTMLLIElement>();
  private readonly eyes = new Map<string, HTMLButtonElement>();
  private lastEye: HTMLButtonElement | null = null;
  private visibleRows: readonly OutlinerRow[] = [];
  private readonly search: HTMLInputElement;
  private readonly matches: HTMLParagraphElement;
  private readonly lightsBox: HTMLElement;
  private readonly list: HTMLElement;
  private readonly footer: HTMLParagraphElement;

  constructor(
    root: HTMLElement,
    private readonly host: ScenePanelHost,
    addMenu: HTMLElement,
  ) {
    const searchId = uniqueId('outliner-search');
    this.search = el('input', {
      id: searchId,
      attributes: {
        type: 'search',
        'aria-label': 'Search the outliner',
        placeholder: 'Search',
        maxlength: String(SEARCH_MAX),
        'aria-keyshortcuts': '/',
      },
    });
    this.search.addEventListener('input', () => this.rebuild());
    const moreButton = iconButton('more', 'More outliner actions');
    moreButton.setAttribute('aria-expanded', 'false');
    const moreList = el('div', { className: 'menu-list', attributes: { hidden: '' } });
    const expandAll = el('button', { text: 'Expand all', attributes: { type: 'button' } });
    const collapseAll = el('button', { text: 'Collapse all', attributes: { type: 'button' } });
    expandAll.addEventListener('click', () => this.setAllCollapsed(false));
    collapseAll.addEventListener('click', () => this.setAllCollapsed(true));
    moreList.append(expandAll, collapseAll);
    moreButton.setAttribute('aria-controls', uniqueId('outliner-more'));
    moreList.id = moreButton.getAttribute('aria-controls') ?? '';
    bindDisclosure(moreButton, moreList);
    this.matches = el('p', { className: 'hint' });
    this.lightsBox = el('section', { className: 'outliner-lights', attributes: { 'aria-label': 'Lights' } });
    this.list = el('div');
    this.footer = el('p', { className: 'hint outliner-footer' });
    root.replaceChildren(
      el('div', { className: 'outliner-tools' }, [
        this.search,
        el('div', { className: 'menu' }, [moreButton, moreList]),
      ]),
      this.matches,
      this.list,
      this.lightsBox,
      this.footer,
    );
    const open = el('button', { text: 'Open model…', attributes: { type: 'button' } });
    open.addEventListener('click', () => host.openFiles());
    const light = el('button', { text: ADD_LIGHT_LABEL, attributes: { type: 'button', disabled: '' } });
    addMenu.replaceChildren(open, light);
    this.show(null);
  }

  /** Rebuilds the list for a model (or for none). */
  show(model: ScenePanelModel | null, selection: SelectionTarget | null = this.selected): void {
    this.model = model;
    this.selected = selection;
    this.rebuild();
  }

  /** The groups shown closed (from the model's saved state); a stale index is ignored. */
  setCollapsed(indices: readonly number[]): void {
    this.collapsed = new Set(indices);
    this.rebuild();
  }

  /** The colours of the key and rim light swatches (`#RRGGBB`, null when off). */
  setLights(lights: { readonly key: string | null; readonly rim: string | null }): void {
    this.lights = lights;
    this.paintLights();
  }

  /** Puts the cursor in the search field (the / key). */
  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  /** Marks the selected row without rebuilding the list. */
  select(selection: Selection['current']): void {
    this.selected = selection;
    for (const [key, item] of this.items) {
      const on = selection !== null && key === `${selection.kind}:${selection.index}`;
      item.setAttribute('aria-selected', String(on));
      const name = item.querySelector('[data-row]');
      if (on) name?.setAttribute('aria-current', 'true');
      else name?.removeAttribute('aria-current');
    }
    if (selection && this.items.has(`${selection.kind}:${selection.index}`)) {
      this.setCurrent(`${selection.kind}:${selection.index}`);
    }
    this.paintCue(selection);
  }

  // The groups above the selection read as marked while they are closed; a pick in the 3D view moves the mark without a rebuild.
  private paintCue(selection: SelectionTarget | null): void {
    const above = new Set(this.groupsAbove(selection));
    for (const [key, item] of this.items) {
      const [kind, index] = key.split(':');
      item.firstElementChild?.classList.toggle('has-selection', kind === 'node' && above.has(Number(index)));
    }
  }

  private groupsAbove(selection: SelectionTarget | null): number[] {
    const doc = this.model?.doc;
    const out: number[] = [];
    if (!doc || !selection) return out;
    let at =
      selection.kind === 'node'
        ? (doc.nodes[selection.index]?.parent ?? -1)
        : (doc.meshes[selection.index]?.node ?? -1);
    for (let guard = 0; at >= 0 && guard <= doc.nodes.length; guard++) {
      out.push(at);
      at = doc.nodes[at]?.parent ?? -1;
    }
    return out;
  }

  /** Flips the visibility of the selected row, else of the eye last used (the H shortcut). */
  toggleSelected(): void {
    const target = this.selected;
    const model = this.model;
    const eye = target ? this.eyes.get(`${target.kind}:${target.index}`) : undefined;
    if (eye) eye.click();
    else if (target && model) {
      // The row is not listed (inside a closed group, or filtered out): the selection still decides.
      if (target.kind === 'node') this.host.setNodeVisible(target.index, !(model.nodeVisible[target.index] === true));
      else this.host.setMeshVisible(target.index, !(model.meshVisible[target.index] === true));
    } else this.lastEye?.click();
  }

  /** Starts renaming the selected row (F2); a row hidden in a closed group or by the search is shown first. */
  renameSelected(): void {
    const target = this.selected;
    if (!target) return;
    const key = `${target.kind}:${target.index}`;
    if (!this.items.has(key)) {
      const above = this.groupsAbove(target).filter((group) => this.collapsed.has(group));
      for (const group of above) this.collapsed.delete(group);
      if (above.length > 0) this.host.collapseChanged?.([...this.collapsed]);
      if (!this.items.has(key) && this.search.value !== '') this.search.value = '';
      this.rebuild();
    }
    this.startRename(target.kind, target.index);
  }

  private setAllCollapsed(closed: boolean): void {
    const doc = this.model?.doc;
    if (!doc || this.search.value.trim() !== '') return;
    this.collapsed = new Set(
      closed ? doc.nodes.flatMap((node, index) => (node.children.length + node.meshes.length > 0 ? [index] : [])) : [],
    );
    this.host.collapseChanged?.([...this.collapsed]);
    this.rebuild();
  }

  private toggleCollapsed(index: number, closed: boolean): void {
    // A search opens the groups it needs by itself; changing the kept state then would show nothing.
    if (this.search.value.trim() !== '') return;
    if (closed) this.collapsed.add(index);
    else this.collapsed.delete(index);
    this.host.collapseChanged?.([...this.collapsed]);
    this.rebuild();
  }

  // The tree's one tab stop: its row and that row's buttons are reachable by Tab, every other row is not.
  private setCurrent(key: string): void {
    if (this.current === key) return;
    const before = this.current ? this.items.get(this.current) : undefined;
    this.current = key;
    if (before) this.markStop(before, false);
    const now = this.items.get(key);
    if (now) this.markStop(now, true);
  }

  private markStop(item: HTMLLIElement, on: boolean): void {
    item.tabIndex = on ? 0 : -1;
    for (const button of item.querySelectorAll<HTMLElement>('button:not(.name)')) button.tabIndex = on ? 0 : -1;
  }

  private rebuild(): void {
    const model = this.model;
    // The list is rebuilt for every change: the focus goes back to the control it was on.
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.list.contains(active) ? active.dataset['focus'] : undefined;
    this.items.clear();
    this.eyes.clear();
    this.lastEye = null;
    this.visibleRows = [];
    if (!model) {
      this.list.replaceChildren(
        el('p', { className: 'hint', text: 'Open a model to list its groups, meshes and lights.' }),
      );
      this.lightsBox.replaceChildren();
      this.matches.textContent = '';
      this.footer.textContent = '';
      return;
    }
    const query = this.search.value.trim();
    const { doc } = model;
    const { rows, total } = outlinerRows(doc, model.names, this.collapsed, query, this.selected, MAX_SCENE_ROWS);
    this.visibleRows = rows;
    const tree = el('ul', { className: 'tree', attributes: { role: 'tree', 'aria-label': 'Nodes and elements' } });
    for (const row of rows) tree.append(this.row(row, model));
    tree.addEventListener('keydown', (event) => this.onKey(event));
    tree.addEventListener('focusin', (event) => {
      const item = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[role="treeitem"]') : null;
      if (item?.dataset['key']) this.setCurrent(item.dataset['key']);
    });
    const parts: Node[] = [tree];
    if (total > rows.length) {
      parts.push(el('p', { className: 'hint', text: `Showing ${rows.length} of ${total}` }));
    }
    this.list.replaceChildren(...parts);
    const first = rows[0];
    const stop =
      this.current && this.items.has(this.current) ? this.current : first ? `${first.kind}:${first.index}` : null;
    this.current = null;
    if (stop) this.setCurrent(stop);
    if (focused) this.list.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus();
    const matched = query ? rows.filter((row) => row.matchRanges.length > 0).length : 0;
    this.matches.textContent = query ? `${matched} match${matched === 1 ? '' : 'es'}` : '';
    this.paintLights();
    const cubes = countCubes(doc.meshes);
    const meshes = doc.meshes.length - cubes;
    this.footer.textContent = [
      plural(doc.nodes.length, 'node', 'nodes'),
      ...(cubes > 0 || meshes === 0 ? [plural(cubes, 'cube', 'cubes')] : []),
      ...(meshes > 0 ? [plural(meshes, 'mesh', 'meshes')] : []),
      plural(doc.animations?.length ?? 0, 'clip', 'clips'),
    ].join(' · ');
    this.select(this.selected);
  }

  private paintLights(): void {
    if (!this.model) return;
    const button = (light: 'key' | 'rim', label: string, hex: string | null): HTMLButtonElement => {
      const swatch = el('span', { className: 'swatch', attributes: { 'aria-hidden': 'true' } });
      if (hex) swatch.style.setProperty('background-color', hex);
      else swatch.classList.add('off');
      const b = el(
        'button',
        { className: 'ghost light-row', attributes: { type: 'button', 'data-focus': `light:${light}` } },
        [icon('sun', { size: 14 }), swatch, el('span', { text: label })],
      );
      b.addEventListener('click', () => this.host.selectLight(light));
      return b;
    };
    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && this.lightsBox.contains(active) ? active.dataset['focus'] : undefined;
    this.lightsBox.replaceChildren(
      el('h3', { text: 'Lights' }),
      button('key', 'Key light', this.lights.key),
      button('rim', 'Rim light', this.lights.rim),
    );
    if (focused) this.lightsBox.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus();
  }

  private row(row: OutlinerRow, model: ScenePanelModel): HTMLLIElement {
    const { kind, index } = row;
    const key = `${kind}:${index}`;
    const name = displayName(model.doc, model.names, kind, index);
    const visible = (kind === 'node' ? model.nodeVisible : model.meshVisible)[index] === true;
    const locked = (kind === 'node' ? model.lockedNodes : model.lockedMeshes)[index] === true;

    const lead = row.hasChildren
      ? iconButton(row.expanded ? 'chevron-down' : 'chevron-right', `${row.expanded ? 'Collapse' : 'Expand'} ${name}`, {
          small: true,
        })
      : el('span', { className: 'row-spacer', attributes: { 'aria-hidden': 'true' } });
    if (lead instanceof HTMLButtonElement) {
      lead.setAttribute('data-focus', `chev:${key}`);
      if (this.search.value.trim() !== '') {
        lead.setAttribute('aria-disabled', 'true');
        lead.title = 'Clear the search to open or close groups';
      }
      lead.addEventListener('click', () => this.toggleCollapsed(index, row.expanded));
    }
    const select = el('button', {
      className: 'name',
      attributes: {
        type: 'button',
        'data-row': key,
        'data-focus': `name:${key}`,
        title: 'Select (F2 renames)',
        tabindex: '-1',
      },
    });
    select.append(icon(kind === 'node' ? 'folder' : 'cube', { size: 14 }), el('span', {}, labelNodes(name, row)));
    select.addEventListener('click', () => this.host.selectRow(kind, index));
    select.addEventListener('dblclick', () => this.startRename(kind, index));
    select.addEventListener('keydown', (event) => {
      if (event.key !== 'F2') return;
      event.preventDefault();
      event.stopPropagation();
      this.startRename(kind, index);
    });

    const eye = iconButton(visible ? 'eye' : 'eye-off', `Hide ${name}`, { small: true, pressed: !visible });
    eye.classList.add('row-eye');
    eye.setAttribute('data-focus', `eye:${key}`);
    eye.addEventListener('click', () => {
      if (kind === 'node') this.host.setNodeVisible(index, !visible);
      else this.host.setMeshVisible(index, !visible);
    });
    eye.addEventListener('focus', () => (this.lastEye = eye));
    eye.addEventListener('click', () => (this.lastEye = eye));
    this.eyes.set(key, eye);
    const lock = iconButton(locked ? 'lock' : 'unlock', `Lock ${name}`, { small: true, pressed: locked });
    lock.classList.add('row-lock');
    lock.setAttribute('data-focus', `lock:${key}`);
    lock.addEventListener('click', () => this.host.setLocked(kind, index, !locked));

    const line = el('div', { className: row.ancestorOfSelected ? 'outliner-row has-selection' : 'outliner-row' }, [
      lead,
      select,
      eye,
      lock,
    ]);
    line.addEventListener('click', (event) => {
      if (event.target instanceof Element && !event.target.closest('button, input')) this.host.selectRow(kind, index);
    });
    const attributes: Record<string, string> = {
      role: 'treeitem',
      'aria-label': name,
      'aria-level': String(row.depth + 1),
      'aria-selected': 'false',
      'data-key': key,
      'data-focus': `item:${key}`,
      tabindex: '-1',
    };
    if (row.hasChildren) attributes['aria-expanded'] = String(row.expanded);
    const item = el('li', { attributes }, [line]);
    item.style.setProperty('--depth', String(row.depth));
    this.markStop(item, false);
    this.items.set(key, item);
    return item;
  }

  // Arrow keys on a row: Up and Down move, Home and End jump, Right opens or enters, Left closes or goes to the group,
  // Enter and Space select, F2 renames. A key pressed on one of the row's own buttons stays with that button.
  private onKey(event: KeyboardEvent): void {
    const item = event.target instanceof HTMLElement ? event.target.closest<HTMLLIElement>('[role="treeitem"]') : null;
    if (!item || event.target !== item) return;
    const rows = this.visibleRows;
    const at = rows.findIndex((row) => `${row.kind}:${row.index}` === item.dataset['key']);
    const row = rows[at];
    if (!row) return;
    const go = (target: number): void => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, target))];
      if (next) this.items.get(`${next.kind}:${next.index}`)?.focus();
    };
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) this.toggleCollapsed(row.index, false);
        else if (row.hasChildren) go(at + 1);
        break;
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded && this.search.value.trim() === '') this.toggleCollapsed(row.index, true);
        else {
          let up = at - 1;
          while (up >= 0 && (rows[up]?.depth ?? 0) >= row.depth) up -= 1;
          if (up >= 0) go(up);
        }
        break;
      case 'Enter':
      case ' ':
        this.host.selectRow(row.kind, row.index);
        break;
      case 'F2':
        event.stopPropagation();
        this.startRename(row.kind, row.index);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  }

  private startRename(kind: 'node' | 'mesh', index: number): void {
    const model = this.model;
    const button = this.list.querySelector<HTMLElement>(`[data-row="${kind}:${index}"]`);
    if (!model || !button) return;
    const input = el('input', {
      attributes: { type: 'text', maxlength: String(MAX_NAME_LENGTH), 'aria-label': 'Name' },
    });
    input.value = displayName(model.doc, model.names, kind, index);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      if (commit) {
        const typed = input.value.trim().slice(0, MAX_NAME_LENGTH);
        const original = (kind === 'node' ? model.doc.nodes[index]?.name : model.doc.meshes[index]?.name) ?? '';
        this.host.rename(kind, index, typed === original ? '' : typed);
      }
      this.rebuild();
      this.items.get(`${kind}:${index}`)?.focus();
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }
}
