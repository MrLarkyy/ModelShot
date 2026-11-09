import { byId } from '../ui/dom';
import type { LayoutStore } from './LayoutStore';
import { PANEL_IDS, PANEL_LIMITS, type PanelId } from './layoutState';
import { clampPanel } from './parseLayout';
import { bindSeparator } from './panelSeparator';

/** Below this width the outliner and the inspector are drawers over the viewport. */
export const DRAWER_BREAKPOINT_PX = 1024;

// The editor shell: sizes, collapse and the drawers. Panels are plain elements of index.html; this only sets their
// size variables, `hidden` and `inert`, and keeps the toggle buttons and separators in step.
export class PanelLayout {
  private readonly query: MediaQueryList;
  private readonly drawerOpen: Record<'outliner' | 'inspector', boolean> = { outliner: false, inspector: false };
  private readonly toggles = new Map<PanelId, HTMLButtonElement>();
  private readonly panels = new Map<PanelId, HTMLElement>();
  private readonly separators = new Map<PanelId, HTMLElement>();
  private readonly syncs: (() => void)[] = [];

  constructor(private readonly store: LayoutStore) {
    this.query = window.matchMedia(`(max-width: ${DRAWER_BREAKPOINT_PX - 1}px)`);
    for (const id of PANEL_IDS) {
      this.panels.set(id, byId(id, HTMLElement));
      this.separators.set(id, byId(`${id}-separator`, HTMLElement));
      const toggle = byId(`${id}-toggle`, HTMLButtonElement);
      this.toggles.set(id, toggle);
      toggle.addEventListener('click', () => this.toggle(id));
    }
    this.bindSeparators();
    this.query.addEventListener('change', () => this.apply());
    store.onChange(() => this.apply());
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !this.drawers) return;
      if (document.querySelector('dialog[open]')) return;
      const open = (['outliner', 'inspector'] as const).find((id) => this.drawerOpen[id]);
      if (!open) return;
      this.drawerOpen[open] = false;
      this.apply();
      this.toggles.get(open)?.focus();
    });
    this.apply();
  }

  get drawers(): boolean {
    return this.query.matches;
  }

  visible(id: PanelId): boolean {
    if (id === 'timeline') return !this.store.state.collapsed.timeline;
    return this.drawers ? this.drawerOpen[id] : !this.store.state.collapsed[id];
  }

  toggle(id: PanelId): void {
    if (id !== 'timeline' && this.drawers) {
      const open = !this.drawerOpen[id];
      this.drawerOpen.outliner = false;
      this.drawerOpen.inspector = false;
      this.drawerOpen[id] = open;
      this.apply();
      if (open) this.panels.get(id)?.querySelector<HTMLElement>('input, button, [tabindex="0"]')?.focus();
      return;
    }
    const collapsed = { ...this.store.state.collapsed, [id]: !this.store.state.collapsed[id] };
    this.store.update({ collapsed });
  }

  private apply(): void {
    const root = document.documentElement.style;
    const drawers = this.drawers;
    const state = this.store.state;
    document.body.dataset['layout'] = drawers ? 'drawers' : 'wide';
    for (const id of PANEL_IDS) {
      const visible = this.visible(id);
      const panel = this.panels.get(id);
      const separator = this.separators.get(id);
      const toggle = this.toggles.get(id);
      if (panel) {
        panel.hidden = !visible;
        panel.inert = !visible;
      }
      if (separator) separator.hidden = !visible || drawers;
      toggle?.setAttribute('aria-expanded', String(visible));
    }
    root.setProperty('--outliner-w', drawers || !this.visible('outliner') ? '0px' : `${state.outlinerPx}px`);
    root.setProperty('--inspector-w', drawers || !this.visible('inspector') ? '0px' : `${state.inspectorPx}px`);
    root.setProperty('--timeline-h', drawers || !this.visible('timeline') ? 'auto' : `${state.timelinePx}px`);
    for (const sync of this.syncs) sync();
  }

  private bindSeparators(): void {
    const specs = [
      { id: 'outliner', key: 'outlinerPx', orientation: 'vertical', direction: 1 },
      { id: 'inspector', key: 'inspectorPx', orientation: 'vertical', direction: -1 },
      { id: 'timeline', key: 'timelinePx', orientation: 'horizontal', direction: -1 },
    ] as const;
    for (const spec of specs) {
      const element = this.separators.get(spec.id);
      if (!element) continue;
      const [min, max] = PANEL_LIMITS[spec.key];
      const bound = bindSeparator({
        element,
        orientation: spec.orientation,
        direction: spec.direction,
        min,
        max,
        value: () => this.store.state[spec.key],
        onResize: (px) => this.store.update({ [spec.key]: clampPanel(spec.key, px) }),
      });
      this.syncs.push(bound.sync);
    }
  }
}
