/** A canvas element's layout size as observed in the page. */
export interface CanvasCssSize {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** Exact device-pixel size when the browser reports it (ResizeObserver `devicePixelContentBoxSize`). */
  readonly devicePixelWidth?: number;
  readonly devicePixelHeight?: number;
}

export interface CanvasSizeLimits {
  /** Largest width and height: min of MAX_VIEWPORT_DIMS and MAX_RENDERBUFFER_SIZE. */
  readonly maxWidth: number;
  readonly maxHeight: number;
  /** Cap on width × height (an option, e.g. for low-end devices); default unbounded. */
  readonly maxPixels?: number;
}

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

const usable = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

/**
 * The backing-store size of a canvas: CSS size × devicePixelRatio, rounded, never below 1 × 1, and scaled down
 * uniformly (aspect kept) to fit the GPU limits and the pixel cap. The exact device-pixel size replaces the product
 * only where they agree within a pixel: it settles rounding, but under emulated pixel ratios (headless browsers)
 * Chromium reports it unscaled.
 */
export function canvasSize(size: CanvasCssSize, limits: CanvasSizeLimits): CanvasSize {
  const dpr = usable(size.devicePixelRatio) ? size.devicePixelRatio : 1;
  let width = (usable(size.cssWidth) ? size.cssWidth : 0) * dpr;
  let height = (usable(size.cssHeight) ? size.cssHeight : 0) * dpr;
  const exactWidth = size.devicePixelWidth;
  const exactHeight = size.devicePixelHeight;
  if (
    usable(exactWidth) &&
    usable(exactHeight) &&
    Math.abs(exactWidth - width) <= 1 &&
    Math.abs(exactHeight - height) <= 1
  ) {
    width = exactWidth;
    height = exactHeight;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const maxPixels = usable(limits.maxPixels) ? limits.maxPixels : Infinity;
  const scale = Math.min(
    1,
    Math.max(1, limits.maxWidth) / width,
    Math.max(1, limits.maxHeight) / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  if (scale < 1) {
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return { width, height };
}
