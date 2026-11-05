import type { RealtimeRenderer, SetSceneResult } from '@modelshot/renderer-rt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewer, type ViewerOptions } from '../src/viewer/Viewer';
import { boxMesh, doc, node } from './editorDocs';

// The parts of the renderer the Viewer reaches outside a bake; a restore is fired by hand, a scene set when told.
class FakeRenderer {
  restored: () => void = () => undefined;
  finishScene: () => void = () => undefined;
  readonly needsRender = false;
  onContextRestored(listener: () => void): () => void {
    this.restored = listener;
    return () => undefined;
  }
  setScene(): Promise<SetSceneResult> {
    return new Promise((resolve) => {
      this.finishScene = () => resolve({ applied: true, warnings: [] });
    });
  }
  resize(): { width: number; height: number } {
    return { width: 1, height: 1 };
  }
  setCamera(): void {}
  render(): void {}
  dispose(): void {}
}

const quiet = { addEventListener: () => undefined, removeEventListener: () => undefined, matches: false };
const canvas = {
  clientHeight: 100,
  style: { setProperty: () => undefined },
  getAttribute: () => null,
  setAttribute: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  getBoundingClientRect: () => ({ width: 100, height: 100 }),
  ownerDocument: {
    defaultView: {
      devicePixelRatio: 1,
      matchMedia: () => quiet,
      ResizeObserver: class {
        observe(): void {}
        disconnect(): void {}
      },
    },
  },
};

function viewer(options: Partial<ViewerOptions> = {}) {
  const renderer = new FakeRenderer();
  const statuses: string[] = [];
  const create = Viewer as unknown as new (c: unknown, r: RealtimeRenderer, o: ViewerOptions) => Viewer;
  const shown = new create(canvas, renderer as unknown as RealtimeRenderer, {
    onStatus: (message) => statuses.push(message),
    onResize: () => undefined,
    onChange: () => undefined,
    ...options,
  });
  return { shown, renderer, statuses };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Viewer', () => {
  it('a restored graphics context draws again and bakes nothing: the renderer kept the baked light', () => {
    const onBakeStarted = vi.fn();
    const { renderer, statuses } = viewer({ onBakeStarted });
    renderer.restored();
    expect(statuses).toEqual(['The graphics context was restored.']);
    expect(onBakeStarted).not.toHaveBeenCalled();
  });

  it('says a document is being set until the renderer has it', async () => {
    const { shown, renderer } = viewer();
    const done = shown.setDocument(doc([node(-1, { meshes: [0] })], [boxMesh(0)]), false, { bake: false });
    expect(shown.settingDocument).toBe(true);
    renderer.finishScene();
    await done;
    expect(shown.settingDocument).toBe(false);
  });
});
