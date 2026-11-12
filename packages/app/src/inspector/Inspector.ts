import { INSPECTOR_TABS, type InspectorTabId } from '../layout/layoutState';
import { displayName } from '../editor/displayName';
import { icon, type IconName } from '../ui/icon';
import { el } from '../ui/dom';
import type { SectionState } from '../ui/sectionState';
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
  readonly sections: SectionState;
  readonly tabChanged: (tab: InspectorTabId) => void;
}

const RAIL_ICONS: Readonly<Record<InspectorTabId, IconName>> = {
  object: 'cube',
  material: 'material',
  light: 'sun',
  look: 'look',
  render: 'render',
};

const CONTROLS = 'input, select, textarea, button';

const controlsOf = (panel: HTMLElement): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(CONTROLS)];

const controlKind = (control: HTMLElement): string =>
  `${control.tagName}:${control instanceof HTMLInputElement ? control.type : ''}`;

// The right panel: a vertical icon rail of WAI-ARIA tabs (Arrow, Home and End move between them) over the Object,
// Material, Light, Look and Render panels, under one title row. The Look and Render panels are mounted by the caller
// into `look` and `render`.
export class Inspector {
  readonly look = el('div', { id: 'look-panel' });
  readonly render = el('div', { id: 'render-panel' });
  readonly camera = el('div', { id: 'camera-panel' });
  private readonly tabs = new Map<InspectorTabId, HTMLButtonElement>();
  private readonly panels = new Map<InspectorTabId, HTMLElement>();
  private readonly titleName = el('h2');
  private readonly titleTag = el('span', { className: 'type-tag' });
  private model: InspectorModel | null = null;
  private lightFocus: 'key' | 'rim' | null = null;
  private current: InspectorTabId;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    root: HTMLElement,
    private readonly host: InspectorHost,
    initial: InspectorTabId,
  ) {
    this.current = initial;
    const list = el('div', {
      className: 'rail',
      attributes: { role: 'tablist', 'aria-label': 'Inspector', 'aria-orientation': 'vertical' },
    });
    const panels: HTMLElement[] = [];
    for (const id of INSPECTOR_TABS) {
      const tab = el('button', {
        id: `tab-${id}`,
        attributes: { type: 'button', role: 'tab', 'aria-controls': `tabpanel-${id}` },
      });
      tab.append(icon(RAIL_ICONS[id]), el('span', { text: TITLES[id] }));
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
    this.panels.get('look')?.append(this.look);
    this.panels.get('render')?.append(this.render, this.camera);
    const title = el('div', { className: 'inspector-title' }, [this.titleName, this.titleTag]);
    root.classList.add('rail-layout');
    root.replaceChildren(list, el('div', { className: 'rail-content' }, [title, ...panels]));
    this.select(initial, false);
    this.refresh();
  }

  get tab(): InspectorTabId {
    return this.current;
  }

  /** Shows `id`; `notify` reports it to the host (`tabChanged`, which keeps the tab with the layout), false for the first paint. */
  select(id: InspectorTabId, notify: boolean): void {
    this.current = id;
    for (const [tabId, tab] of this.tabs) {
      const on = tabId === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = this.panels.get(tabId);
      if (panel) panel.hidden = !on;
    }
    this.retitle();
    if (notify) this.host.tabChanged(id);
  }

  /** Shows `id` from a control inside another tab and moves the focus to its tab, which the hidden control cannot keep. */
  show(id: InspectorTabId): void {
    this.select(id, true);
    this.tabs.get(id)?.focus();
  }

  /** Shows the Light tab with `light` first. */
  showLight(light: 'key' | 'rim'): void {
    this.lightFocus = light;
    this.refreshNow();
    this.select('light', true);
    this.tabs.get('light')?.focus();
  }

  // The panels follow in the next task: a field committed by Tab sends its change event before the focus has reached
  // the next field, and a panel rebuilt in between would remove the field the focus is going to.
  update(model: InspectorModel | null): void {
    this.model = model;
    this.pending ??= setTimeout(() => this.refreshNow(), 0);
  }

  private refreshNow(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
    this.refresh();
  }

  private retitle(): void {
    const model = this.model;
    const target = model?.selection;
    const selected = this.current === 'object' || this.current === 'material';
    if (model && target && selected) {
      this.titleName.textContent = displayName(model.doc, model.names, target.kind, target.index);
      this.titleTag.textContent = target.kind === 'node' ? 'Group' : 'Element';
    } else {
      this.titleName.textContent = TITLES[this.current];
      this.titleTag.textContent = this.current === 'light' && model ? model.look.name : '';
    }
    this.titleTag.hidden = this.titleTag.textContent === '';
  }

  // A rebuilt panel keeps the keyboard focus: the control that had it is found again by its `data-focus` key, else by
  // its place among the panel's controls (same element and type), so Tab through the fields of an edit goes on from
  // where it was.
  private refresh(): void {
    const set = (id: InspectorTabId, parts: readonly HTMLElement[]): void => {
      const panel = this.panels.get(id);
      if (!panel) return;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && panel.contains(active);
      const key = inside ? active.dataset['focus'] : undefined;
      const at = inside ? controlsOf(panel).indexOf(active) : -1;
      const kind = active instanceof HTMLElement ? controlKind(active) : '';
      panel.replaceChildren(...parts);
      const byKey = key
        ? [...panel.querySelectorAll<HTMLElement>('[data-focus]')].find((c) => c.dataset['focus'] === key)
        : undefined;
      if (byKey) return byKey.focus();
      const again = at >= 0 ? controlsOf(panel)[at] : undefined;
      if (again && controlKind(again) === kind) again.focus();
    };
    set('object', buildObjectTab(this.model, this.host, this.host.sections));
    set('material', buildMaterialTab(this.model, this.host, this.host.sections));
    set(
      'light',
      this.model
        ? buildLightTab(this.model.look, this.lightFocus, this.host.sections)
        : [el('p', { className: 'hint', text: 'Open a model to edit its objects, materials and light.' })],
    );
    this.retitle();
  }

  private onKey(event: KeyboardEvent, id: InspectorTabId): void {
    const at = INSPECTOR_TABS.indexOf(id);
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % INSPECTOR_TABS.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = (at - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
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
