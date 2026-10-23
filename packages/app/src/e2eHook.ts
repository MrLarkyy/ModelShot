import type { OrbitController, OrbitState } from '@modelshot/renderer-rt';
import type { App } from './App';

interface Pixels {
  readonly width: number;
  readonly height: number;
  /** Base64 of the RGBA bytes. */
  readonly data: string;
}

export interface MsAppHook {
  readonly orbit: OrbitController;
  state(): OrbitState;
  setWatchdogMs(ms: number): void;
  hangNextLoad(): void;
  failNextScene(): void;
  previewPixels(): Pixels;
  renderPixels(): Promise<Pixels | null>;
  loseContext(): boolean;
}

declare global {
  interface Window {
    __msApp?: MsAppHook;
  }
}

function base64(bytes: Uint8ClampedArray): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Only the e2e build (vite --mode e2e) includes this module: the tests read the view's state and pixels through it.
export function installE2eHook(app: App): void {
  const internals = app.internals();
  const { viewer } = internals;
  if (!viewer) return;
  const preview = document.getElementById('preview') as HTMLCanvasElement;
  window.__msApp = {
    orbit: viewer.orbit,
    state: () => viewer.orbit.state(),
    setWatchdogMs: internals.setWatchdogMs,
    hangNextLoad: internals.hangNextLoad,
    failNextScene: internals.failNextScene,
    previewPixels: () => {
      viewer.renderNow();
      const copy = document.createElement('canvas');
      copy.width = preview.width;
      copy.height = preview.height;
      const context = copy.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(preview, 0, 0);
      const image = context.getImageData(0, 0, copy.width, copy.height);
      return { width: image.width, height: image.height, data: base64(image.data) };
    },
    renderPixels: async () => {
      const tracer = await internals.renderSession.tracer();
      const image = tracer.readImage();
      return image ? { width: image.width, height: image.height, data: base64(image.data) } : null;
    },
    loseContext: () => {
      const extension = preview.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      extension?.loseContext();
      window.setTimeout(() => extension?.restoreContext(), 100);
      return extension !== undefined && extension !== null;
    },
  };
}
