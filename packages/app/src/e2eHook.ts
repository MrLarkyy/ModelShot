import type { OrbitController, OrbitState } from '@modelshot/renderer-rt';
import type { App } from './App';
import type { NodeEdit } from './session/NodeEdit';

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
  /** The next scene the app sets comes back not applied, as when the scene changed meanwhile. */
  refuseNextScene(): void;
  /** The next scene the app sets waits until `releaseScene`; `sceneHeld` tells once it waits. */
  holdNextScene(): void;
  sceneHeld(): boolean;
  releaseScene(): void;
  /** What a gizmo release commits; resolves whether the scene took the edit. */
  commitNodeEdit(edit: NodeEdit): Promise<boolean>;
  /** Sets the editor's relight delay (`RELIGHT_DELAY_MS`); false before the editor tools loaded. */
  setRelightDelayMs(ms: number): boolean;
  previewPixels(): Pixels;
  renderPixels(): Promise<Pixels | null>;
  loseContext(): boolean;
  /** Median milliseconds of the overlay's last draws; null before the editor tools loaded. */
  overlayMedianMs(): number | null;
  /** Pixels of the overlay layer that are not transparent. */
  overlayPixels(): number;
  /** The gizmo handles in CSS pixels of the viewport: the end points of each handle's first segment. */
  gizmoHandles(): { axis: number; from: { x: number; y: number }; to: { x: number; y: number } }[];
  /** Shows the control specimen over the app (every control variant); once, a second call does nothing. */
  showSpecimen(): Promise<void>;
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
  let hold: ReturnType<typeof internals.holdNextScene> | null = null;
  window.__msApp = {
    orbit: viewer.orbit,
    state: () => viewer.orbit.state(),
    setWatchdogMs: internals.setWatchdogMs,
    hangNextLoad: internals.hangNextLoad,
    failNextScene: internals.failNextScene,
    refuseNextScene: internals.refuseNextScene,
    holdNextScene: () => {
      hold = internals.holdNextScene();
    },
    sceneHeld: () => hold?.reached() ?? false,
    releaseScene: () => hold?.release(),
    commitNodeEdit: internals.commitNodeEdit,
    setRelightDelayMs: (ms) => {
      const tools = internals.editorTools();
      if (tools) tools.relightDelayMs = ms;
      return tools !== null;
    },
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
    overlayMedianMs: () => internals.editorTools()?.overlay.medianDrawMs ?? null,
    overlayPixels: () => {
      const overlay = document.getElementById('overlay') as HTMLCanvasElement;
      const data = overlay.getContext('2d')?.getImageData(0, 0, overlay.width, overlay.height).data;
      let count = 0;
      for (let i = 3; data && i < data.length; i += 4) if ((data[i] ?? 0) > 0) count += 1;
      return count;
    },
    gizmoHandles: () =>
      (internals.editorTools()?.overlay.handles ?? []).flatMap((handle) => {
        const from = handle.polyline[0];
        const to = handle.polyline[1];
        return from && to ? [{ axis: handle.axis, from, to }] : [];
      }),
    showSpecimen: async () => {
      if (document.getElementById('specimen')) return;
      const { buildSpecimen } = await import('./ui/specimen');
      if (!document.getElementById('specimen')) document.body.append(buildSpecimen());
    },
    loseContext: () => {
      const extension = preview.getContext('webgl2')?.getExtension('WEBGL_lose_context');
      extension?.loseContext();
      window.setTimeout(() => extension?.restoreContext(), 100);
      return extension !== undefined && extension !== null;
    },
  };
}
