export type ModelViewModel = 'alpha-plane' | 'mesh-shapes' | 'render-order';
export type ModelViewMode = 'raster' | 'raycast';

export interface ModelViewVariant {
  readonly model: ModelViewModel;
  readonly mode: ModelViewMode;
}

const VARIANTS: Readonly<Record<string, ModelViewVariant>> = Object.freeze({
  'alpha-plane-raster': { model: 'alpha-plane', mode: 'raster' },
  'alpha-plane-raycast': { model: 'alpha-plane', mode: 'raycast' },
  'mesh-shapes-raster': { model: 'mesh-shapes', mode: 'raster' },
  'mesh-shapes-raycast': { model: 'mesh-shapes', mode: 'raycast' },
  'render-order-raster': { model: 'render-order', mode: 'raster' },
  'render-order-raycast': { model: 'render-order', mode: 'raycast' },
});

/** The `variant` query parameter, looked up as an own key only (so `constructor` or `__proto__` are unknown). */
export function parseModelViewVariant(search: string): ModelViewVariant {
  const name = new URLSearchParams(search).get('variant');
  const variant = name !== null && Object.hasOwn(VARIANTS, name) ? VARIANTS[name] : undefined;
  if (!variant) throw new Error(`unknown variant "${String(name)}"`);
  return variant;
}
