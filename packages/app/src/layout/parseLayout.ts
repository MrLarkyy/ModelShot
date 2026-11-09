import {
  DEFAULT_LAYOUT,
  INSPECTOR_TABS,
  OVERLAY_IDS,
  PANEL_IDS,
  PANEL_LIMITS,
  type LayoutState,
  type OverlayId,
  type PanelId,
} from './layoutState';

/** A stored layout larger than this is ignored: the record is a handful of numbers and flags. */
export const MAX_LAYOUT_BYTES = 2048;

export function clampPanel(key: keyof typeof PANEL_LIMITS, value: number): number {
  const [lo, hi] = PANEL_LIMITS[key];
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** The own data property `key` of `source`, or undefined: a getter or an inherited value never counts. */
function ownValue(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function flags<K extends string>(ids: readonly K[], stored: unknown, fallback: Readonly<Record<K, boolean>>) {
  const source = record(stored);
  const out: Record<K, boolean> = { ...fallback };
  for (const id of ids) {
    const value = ownValue(source, id);
    if (typeof value === 'boolean') out[id] = value;
  }
  return out;
}

/** The layout a stored string holds; anything unreadable, oversized or out of range falls back to the default. */
export function parseLayout(raw: string | null): LayoutState {
  if (raw === null || raw.length > MAX_LAYOUT_BYTES) return DEFAULT_LAYOUT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LAYOUT;
  }
  const source = record(parsed);
  const size = (key: keyof typeof PANEL_LIMITS): number => {
    const value = ownValue(source, key);
    return typeof value === 'number' && Number.isFinite(value) ? clampPanel(key, value) : DEFAULT_LAYOUT[key];
  };
  const tab = ownValue(source, 'tab');
  return {
    outlinerPx: size('outlinerPx'),
    inspectorPx: size('inspectorPx'),
    timelinePx: size('timelinePx'),
    collapsed: flags<PanelId>(PANEL_IDS, source['collapsed'], DEFAULT_LAYOUT.collapsed),
    overlays: flags<OverlayId>(OVERLAY_IDS, source['overlays'], DEFAULT_LAYOUT.overlays),
    tab: INSPECTOR_TABS.find((id) => id === tab) ?? DEFAULT_LAYOUT.tab,
  };
}
