import { INSPECTOR_TABS, type InspectorTabId } from '../layout/layoutState';
import { el } from '../ui/dom';
import type { InspectorModel } from './InspectorModel';
import { buildLightTab } from './LightTab';
import { buildMaterialTab, type MaterialTabHost } from './MaterialTab';
import { buildObjectTab, type ObjectTabHost } from './ObjectTab';

const TITLES: Readonly<Record<InspectorTabId, string>> = {
  object: 'Object',
  material: 'Material',
  light: 'Light',
  look: 'Look',
  render: 'Render',
};

export interface InspectorHost extends ObjectTabHost, MaterialTabHost {
  readonly tabChanged: (tab: InspectorTabId) => void;
}

// The right panel: WAI-ARIA tabs (Arrow, Home and End move between them) over the Object, Material, Light, Look and
// Render panels. The Look and Render panels are mounted by the caller into `look` and `render`.
export class Inspector {
  readonly look = el('div', { id: 'look-panel' });
  readonly render = el('div', { id: 'render-panel' });
  readonly camera = el('div', { id: 'camera-panel' });
  private readonly tabs = new Map<InspectorTabId, HTMLButtonElement>();
  private readonly panels = new Map<InspectorTabId, HTMLElement>();
  private model: InspectorModel | null = null;
  private lightFocus: 'key' | 'rim' | null = null;
  private current: InspectorTabId;

  constructor(
    root: HTMLElement,
    private readonly host: InspectorHost,
    initial: InspectorTabId,
  ) {
    this.current = initial;
    const list = el('div', { attributes: { role: 'tablist', 'aria-label': 'Inspector' } });
    const panels: HTMLElement[] = [];
    for (const id of INSPECTOR_TABS) {
      const tab = el('button', {
        id: `tab-${id}`,
        text: TITLES[id],
        attributes: { type: 'button', role: 'tab', 'aria-controls': `tabpanel-${id}` },
      });
      tab.addEventListener('click', () => this.select(id, true));
      tab.addEventListener('keydown', (event) => this.onKey(event, id));
      const panel = el('div', {
        id: `tabpanel-${id}`,
        attributes: { role: 'tabpanel', 'aria-labelledby': `tab-${id}`, tabindex: '-1' },
      });
      this.tabs.set(id, tab);
      this.panels.set(id, panel);
      list.append(tab);
      panels.push(panel);
    }
    this.panels.get('look')?.append(el('h2', { text: 'Look' }), this.look);
    this.panels
      .get('render')
      ?.append(el('h2', { text: 'Render' }), this.render, el('h3', { text: 'Camera' }), this.camera);
    root.replaceChildren(list, ...panels);
    this.select(initial, false);
    this.refresh();
  }

  get tab(): InspectorTabId {
    return this.current;
  }

  /** Shows `id`; `focus` moves the focus to its tab (a keyboard or pointer choice). */
  select(id: InspectorTabId, notify: boolean): void {
    this.current = id;
    for (const [tabId, tab] of this.tabs) {
      const on = tabId === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = this.panels.get(tabId);
      if (panel) panel.hidden = !on;
    }
    if (notify) this.host.tabChanged(id);
  }

  /** Shows the Light tab with `light` first. */
  showLight(light: 'key' | 'rim'): void {
    this.lightFocus = light;
    this.refresh();
    this.select('light', true);
    this.tabs.get('light')?.focus();
  }

  update(model: InspectorModel | null): void {
    this.model = model;
    this.refresh();
  }

  private refresh(): void {
    const set = (id: InspectorTabId, parts: readonly HTMLElement[]): void => {
      this.panels.get(id)?.replaceChildren(el('h2', { text: TITLES[id] }), ...parts);
    };
    set('object', buildObjectTab(this.model, this.host));
    set('material', buildMaterialTab(this.model, this.host));
    set(
      'light',
      this.model
        ? buildLightTab(this.model.look, this.lightFocus)
        : [el('p', { className: 'hint', text: 'No model open.' })],
    );
  }

  private onKey(event: KeyboardEvent, id: InspectorTabId): void {
    const at = INSPECTOR_TABS.indexOf(id);
    let next: number;
    if (event.key === 'ArrowRight') next = (at + 1) % INSPECTOR_TABS.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = INSPECTOR_TABS.length - 1;
    else return;
    event.preventDefault();
    const target = INSPECTOR_TABS[next];
    if (!target) return;
    this.select(target, true);
    this.tabs.get(target)?.focus();
  }
}
