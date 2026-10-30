import type { SceneDocument, SceneTextureFilter } from '@modelshot/scene';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import { el, uniqueId } from '../ui/dom';

/** Rows listed; a larger scene lists the first ones and says how many are left out. */
export const MAX_SCENE_ROWS = 500;

export interface ScenePanelHost {
  readonly setNodeVisible: (index: number, visible: boolean) => void;
  readonly setMeshVisible: (index: number, visible: boolean) => void;
  readonly setTextureFilter: (index: number, filter: SceneTextureFilter) => void;
  readonly setArms: (arms: PlayerArmsChoice) => void;
}

export interface ScenePanelModel {
  readonly doc: SceneDocument;
  readonly nodeVisible: readonly boolean[];
  readonly meshVisible: readonly boolean[];
  readonly textureFilter: readonly SceneTextureFilter[];
  readonly player: { readonly arms: PlayerArmsChoice } | null;
}

// The nodes (groups) and meshes (elements) of the open model with a visibility checkbox each. Names come from the file
// and are set as text only.
export class ScenePanel {
  private rows = 0;
  private selected: HTMLInputElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: ScenePanelHost,
  ) {}

  /** Rebuilds the list for a model (or for none). */
  show(model: ScenePanelModel | null): void {
    this.selected = null;
    if (!model) {
      this.root.replaceChildren(el('p', { className: 'hint', text: 'No model open.' }));
      return;
    }
    this.rows = 0;
    const { doc } = model;
    const list = el('ul', { className: 'tree', attributes: { 'aria-label': 'Nodes and elements' } });
    for (const index of doc.rootNodes) this.appendNode(list, model, index);
    doc.meshes.forEach((mesh, index) => {
      if (mesh.node < 0) this.appendMesh(list, model, index);
    });
    const parts: Node[] = [];
    if (model.player) parts.push(this.armsControl(model.player.arms));
    const filters = this.filterControl(model);
    if (filters) parts.push(filters);
    parts.push(list);
    const hidden = this.countRows(doc) - this.rows;
    if (hidden > 0) parts.push(el('p', { className: 'hint', text: `${hidden} more rows are not listed.` }));
    this.root.replaceChildren(...parts);
  }

  /** Flips the checkbox last used or focused (the H shortcut). */
  toggleSelected(): void {
    this.selected?.click();
  }

  private countRows(doc: SceneDocument): number {
    return doc.nodes.length + doc.meshes.length;
  }

  private armsControl(arms: PlayerArmsChoice): HTMLElement {
    const group = uniqueId('arms');
    const radio = (value: PlayerArmsChoice, label: string): HTMLLabelElement => {
      const input = el('input', { attributes: { type: 'radio', name: group, value } });
      input.checked = arms === value;
      input.addEventListener('change', () => {
        if (input.checked) this.host.setArms(value);
      });
      return el('label', { className: 'choice' }, [input, el('span', { text: label })]);
    };
    return el('fieldset', {}, [
      el('legend', { text: 'Arms' }),
      radio('classic', 'Classic (4 px)'),
      radio('slim', 'Slim (3 px)'),
    ]);
  }

  private filterControl(model: ScenePanelModel): HTMLElement | null {
    const rows: HTMLElement[] = [];
    model.doc.textures.forEach((texture, index) => {
      if (texture.missing || rows.length >= MAX_SCENE_ROWS) return;
      const select = el('select');
      select.append(
        el('option', { text: 'Nearest (pixel art)', attributes: { value: 'nearest' } }),
        el('option', { text: 'Linear (smooth)', attributes: { value: 'linear' } }),
      );
      select.value = model.textureFilter[index] ?? 'nearest';
      select.addEventListener('change', () => {
        this.host.setTextureFilter(index, select.value === 'linear' ? 'linear' : 'nearest');
      });
      const name = texture.name || `Texture ${index + 1}`;
      rows.push(el('label', { className: 'field' }, [el('span', { text: name }), select]));
    });
    return rows.length > 0 ? el('fieldset', {}, [el('legend', { text: 'Texture filtering' }), ...rows]) : null;
  }

  private checkbox(label: string, checked: boolean, onChange: (visible: boolean) => void): HTMLLIElement | null {
    if (this.rows >= MAX_SCENE_ROWS) return null;
    this.rows += 1;
    const input = el('input', { attributes: { type: 'checkbox' } });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    input.addEventListener('focus', () => (this.selected = input));
    input.addEventListener('click', () => (this.selected = input));
    return el('li', {}, [el('label', { className: 'choice' }, [input, el('span', { text: label })])]);
  }

  private appendNode(parent: HTMLElement, model: ScenePanelModel, index: number): void {
    const node = model.doc.nodes[index];
    if (!node) return;
    const item = this.checkbox(node.name || `Group ${index + 1}`, model.nodeVisible[index] === true, (visible) =>
      this.host.setNodeVisible(index, visible),
    );
    if (!item) return;
    const children = el('ul', { className: 'tree' });
    for (const child of node.children) this.appendNode(children, model, child);
    node.meshes.forEach((mesh) => this.appendMesh(children, model, mesh));
    if (children.childElementCount > 0) item.append(children);
    parent.append(item);
  }

  private appendMesh(parent: HTMLElement, model: ScenePanelModel, index: number): void {
    const mesh = model.doc.meshes[index];
    if (!mesh) return;
    const item = this.checkbox(mesh.name || `Element ${index + 1}`, model.meshVisible[index] === true, (visible) =>
      this.host.setMeshVisible(index, visible),
    );
    if (item) parent.append(item);
  }
}
