import type { CanvasCssSize } from './canvasSize';

/**
 * Reports `element`'s size now and after every layout resize or devicePixelRatio change (browser zoom, moving the
 * window to another screen). Uses the exact device-pixel box where supported. Returns a function that stops observing.
 */
export function observeCanvasSize(element: HTMLElement, onSize: (size: CanvasCssSize) => void): () => void {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error('observeCanvasSize needs an element attached to a window');
  let last: ResizeObserverEntry | null = null;
  let stopped = false;

  const report = (): void => {
    if (stopped) return;
    const dpr = view.devicePixelRatio || 1;
    const rect = element.getBoundingClientRect();
    const box = last?.contentBoxSize[0];
    const devicePixels = last?.devicePixelContentBoxSize?.[0];
    onSize({
      cssWidth: box?.inlineSize ?? rect.width,
      cssHeight: box?.blockSize ?? rect.height,
      devicePixelRatio: dpr,
      ...(devicePixels ? { devicePixelWidth: devicePixels.inlineSize, devicePixelHeight: devicePixels.blockSize } : {}),
    });
  };

  const observer = new view.ResizeObserver((entries) => {
    last = entries[entries.length - 1] ?? last;
    report();
  });
  try {
    observer.observe(element, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(element, { box: 'content-box' });
  }

  // A resolution query matches only the current ratio; re-arm it after every change.
  let query: MediaQueryList | null = null;
  const onResolutionChange = (): void => {
    query?.removeEventListener('change', onResolutionChange);
    if (stopped) return;
    query = view.matchMedia(`(resolution: ${view.devicePixelRatio || 1}dppx)`);
    query.addEventListener('change', onResolutionChange);
    report();
  };
  query = view.matchMedia(`(resolution: ${view.devicePixelRatio || 1}dppx)`);
  query.addEventListener('change', onResolutionChange);

  return () => {
    stopped = true;
    observer.disconnect();
    query?.removeEventListener('change', onResolutionChange);
  };
}
