export const INSPECTOR_TABS = ['object', 'material', 'light', 'look', 'render'] as const;
export type InspectorTabId = (typeof INSPECTOR_TABS)[number];

export const OVERLAY_IDS = ['grid', 'axis', 'stats', 'presets', 'gizmos'] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export const PANEL_IDS = ['outliner', 'inspector', 'timeline'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** What the editor shell remembers for this browser: panel sizes, collapsed panels, overlay toggles, the inspector tab. */
export interface LayoutState {
  readonly outlinerPx: number;
  readonly inspectorPx: number;
  readonly timelinePx: number;
  readonly collapsed: Readonly<Record<PanelId, boolean>>;
  readonly overlays: Readonly<Record<OverlayId, boolean>>;
  readonly tab: InspectorTabId;
}

/** Pixel range of each resizable panel. */
export const PANEL_LIMITS: Readonly<Record<'outlinerPx' | 'inspectorPx' | 'timelinePx', readonly [number, number]>> = {
  outlinerPx: [180, 480],
  inspectorPx: [260, 520],
  timelinePx: [96, 320],
};

export const DEFAULT_LAYOUT: LayoutState = {
  outlinerPx: 260,
  inspectorPx: 320,
  timelinePx: 132,
  collapsed: { outliner: false, inspector: false, timeline: false },
  overlays: { grid: true, axis: true, stats: false, presets: true, gizmos: true },
  tab: 'object',
};
