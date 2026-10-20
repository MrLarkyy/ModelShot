/** A texture's `render_sides` in Blockbench. */
export type RenderSides = 'auto' | 'front' | 'double';

export const RENDER_SIDES: readonly RenderSides[] = ['auto', 'front', 'double'];

/**
 * What `auto` means in a model format (Blockbench `Canvas.getRenderSide` with the default `render_sides` setting): only
 * `java_block` sets `Format.render_sides` (`front`); every other format falls back to double-sided.
 */
export function formatDoubleSided(modelFormat: string): boolean {
  return modelFormat !== 'java_block';
}

export function isDoubleSided(sides: RenderSides, formatDefault: boolean): boolean {
  return sides === 'auto' ? formatDefault : sides === 'double';
}
