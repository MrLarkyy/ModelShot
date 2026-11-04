import type { SceneDocument } from '@modelshot/scene';
import { displayName, MAX_NAME_LENGTH } from '../editor/displayName';
import type { Selection, SelectionTarget } from '../editor/Selection';
import { el, uniqueId } from '../ui/dom';

/** Rows listed; a larger scene lists the first ones and says how many are left out. */
export const MAX_SCENE_ROWS = 500;

export interface ScenePanelHost {
  readonly setNodeVisible: (index: number, visible: boolean) => void;
  readonly setMeshVisible: (index: number, visible: boolean) => void;
  readonly selectRow: (kind: 'node' | 'mesh', index: number) => void;
  readonly setLocked: (kind: 'node' | 'mesh', index: number, locked: boolean) => void;
  /** Gives a node or element a label; an empty one takes the file's name back. */
  readonly rename: (kind: 'node' | 'mesh', index: number, name: string) => void;
  readonly selectLight: (light: 'key' | 'rim') => void;
  readonly openFiles: () => void;
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

// The outliner: the nodes (groups) and meshes (elements) of the open model with select, rename, hide, lock and search,
// and the look's lights. Names come from the file or the user and are set as text only.
export class ScenePanel {
  private rows = 0;
  private model: ScenePanelModel | null = null;
  private lastChecked: HTMLInputElement | null = null;
  private readonly checkboxes = new Map<string, HTMLInputElement>();
  private readonly search: HTMLInputElement;
  private readonly matches: HTMLParagraphElement;
  private readonly lights: HTMLElement;
  private readonly list: HTMLElement;
  private selected: SelectionTarget | null = null;

  constructor(
    root: HTMLElement,
    private readonly host: ScenePanelHost,
    addMenu: HTMLElement,
  ) {
    const searchId = uniqueId('outliner-search');
    this.search = el('input', {
      id: searchId,
      attributes: { type: 'search', 'aria-label': 'Search the outliner', placeholder: 'Search', maxlength: '128' },
    });
    this.search.addEventListener('input', () => this.rebuild());
    this.matches = el('p', { className: 'hint' });
    this.lights = el('section', { attributes: { 'aria-label': 'Lights' } });
    this.list = el('div');
    root.replaceChildren(this.search, this.matches, this.list, this.lights);
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

  /** Marks the selected row without rebuilding the list. */
  select(selection: Selection['current']): void {
    this.selected = selection;
    for (const button of this.list.querySelectorAll<HTMLElement>('[data-row]')) {
      const [kind, index] = (button.dataset['row'] ?? '').split(':');
      const on = selection !== null && selection.kind === kind && String(selection.index) === index;
      if (on) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  /** Flips the visibility of the selected row, else of the checkbox last used (the H shortcut). */
  toggleSelected(): void {
    const target = this.selected;
    const box = target ? this.checkboxes.get(`${target.kind}:${target.index}`) : undefined;
    (box ?? this.lastChecked)?.click();
  }

  /** Starts renaming the selected row (F2). */
  renameSelected(): void {
    const target = this.selected;
    if (target) this.startRename(target.kind, target.index);
  }

  private rebuild(): void {
    const model = this.model;
    this.checkboxes.clear();
    this.lastChecked = null;
    this.rows = 0;
    if (!model) {
      this.list.replaceChildren(el('p', { className: 'hint', text: 'No model open.' }));
      this.lights.replaceChildren();
      this.matches.textContent = '';
      return;
    }
    const query = this.search.value.trim().toLowerCase();
    const { doc } = model;
    const matching = query ? this.matchingRows(model, query) : null;
    const list = el('ul', { className: 'tree', attributes: { 'aria-label': 'Nodes and elements' } });
    for (const index of doc.rootNodes) this.appendNode(list, model, index, matching);
    doc.meshes.forEach((mesh, index) => {
      if (mesh.node < 0) this.appendMesh(list, model, index, matching);
    });
    const parts: Node[] = [list];
    const left = doc.nodes.length + doc.meshes.length - this.rows;
    if (left > 0 && !matching) parts.push(el('p', { className: 'hint', text: `${left} more rows are not listed.` }));
    this.list.replaceChildren(...parts);
    this.matches.textContent = matching ? `${matching.count} match${matching.count === 1 ? '' : 'es'}` : '';
    this.lights.replaceChildren(
      el('h3', { text: 'Lights' }),
      this.lightButton('key', 'Key light'),
      this.lightButton('rim', 'Rim light'),
    );
    this.select(this.selected);
  }

  private lightButton(light: 'key' | 'rim', label: string): HTMLButtonElement {
    const button = el('button', { className: 'name', text: label, attributes: { type: 'button' } });
    button.addEventListener('click', () => this.host.selectLight(light));
    return button;
  }

  // The rows whose label contains the query, and the groups above them; `count` counts the rows that match themselves.
  private matchingRows(model: ScenePanelModel, query: string): { keep: Set<string>; count: number } {
    const keep = new Set<string>();
    let count = 0;
    const { doc, names } = model;
    const mark = (kind: 'node' | 'mesh', index: number): boolean => {
      const own = displayName(doc, names, kind, index).toLowerCase().includes(query);
      let below = false;
      if (kind === 'node') {
        const node = doc.nodes[index];
        for (const child of node?.children ?? []) below = mark('node', child) || below;
        for (const mesh of node?.meshes ?? []) below = mark('mesh', mesh) || below;
      }
      if (own) count += 1;
      if (own || below) keep.add(`${kind}:${index}`);
      return own || below;
    };
    for (const index of doc.rootNodes) mark('node', index);
    doc.meshes.forEach((mesh, index) => {
      if (mesh.node < 0) mark('mesh', index);
    });
    return { keep, count };
  }

  private appendNode(
    parent: HTMLElement,
    model: ScenePanelModel,
    index: number,
    matching: { keep: Set<string> } | null,
  ): void {
    const node = model.doc.nodes[index];
    if (!node || (matching && !matching.keep.has(`node:${index}`))) return;
    const item = this.row('node', index, model);
    if (!item) return;
    const children = el('ul', { className: 'tree' });
    for (const child of node.children) this.appendNode(children, model, child, matching);
    node.meshes.forEach((mesh) => this.appendMesh(children, model, mesh, matching));
    if (children.childElementCount > 0) item.append(children);
    parent.append(item);
  }

  private appendMesh(
    parent: HTMLElement,
    model: ScenePanelModel,
    index: number,
    matching: { keep: Set<string> } | null,
  ): void {
    if (!model.doc.meshes[index] || (matching && !matching.keep.has(`mesh:${index}`))) return;
    const item = this.row('mesh', index, model);
    if (item) parent.append(item);
  }

  private row(kind: 'node' | 'mesh', index: number, model: ScenePanelModel): HTMLLIElement | null {
    if (this.rows >= MAX_SCENE_ROWS) return null;
    this.rows += 1;
    const name = displayName(model.doc, model.names, kind, index);
    const visible = (kind === 'node' ? model.nodeVisible : model.meshVisible)[index] === true;
    const locked = (kind === 'node' ? model.lockedNodes : model.lockedMeshes)[index] === true;
    const box = el('input', { attributes: { type: 'checkbox', 'aria-label': `Visible: ${name}` } });
    box.checked = visible;
    box.addEventListener('change', () => {
      if (kind === 'node') this.host.setNodeVisible(index, box.checked);
      else this.host.setMeshVisible(index, box.checked);
    });
    box.addEventListener('focus', () => (this.lastChecked = box));
    box.addEventListener('click', () => (this.lastChecked = box));
    this.checkboxes.set(`${kind}:${index}`, box);
    const select = el('button', {
      className: 'name',
      text: name,
      attributes: { type: 'button', 'data-row': `${kind}:${index}`, title: 'Select (F2 renames)' },
    });
    select.addEventListener('click', () => this.host.selectRow(kind, index));
    select.addEventListener('dblclick', () => this.startRename(kind, index));
    select.addEventListener('keydown', (event) => {
      if (event.key === 'F2') {
        event.preventDefault();
        event.stopPropagation();
        this.startRename(kind, index);
      }
    });
    const lock = el('button', {
      className: 'lock',
      text: locked ? 'Locked' : 'Lock',
      attributes: { type: 'button', 'aria-pressed': String(locked), 'aria-label': `Lock ${name}` },
    });
    lock.addEventListener('click', () => this.host.setLocked(kind, index, !locked));
    return el('li', {}, [el('div', { className: 'outliner-row' }, [box, select, lock])]);
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
      this.list.querySelector<HTMLElement>(`[data-row="${kind}:${index}"]`)?.focus();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }
}
