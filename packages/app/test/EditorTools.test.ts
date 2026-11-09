import { animateScene, type SceneAnimation, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import type { SetSceneResult } from '@modelshot/renderer-rt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTools, RELIGHT_DELAY_MS, type EditorState } from '../src/editor/EditorTools';
import { Selection } from '../src/editor/Selection';
import type { LayoutStore } from '../src/layout/LayoutStore';
import type { NodeEdit } from '../src/session/NodeEdit';
import { sceneBakes } from '../src/session/sceneBakes';
import { setNodeEdit, withNodeEdits } from '../src/session/withNodeEdits';
import type { Viewer } from '../src/viewer/Viewer';
import { boxMesh, doc, node } from './editorDocs';

type Listener = (event: object) => void;

// Just enough of an element for the timeline, the overlay canvas and the viewport in a Node test; the viewport's
// pointer listeners can be fired.
class FakeElement {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  value = '';
  max = '';
  checked = false;
  clientWidth = 0;
  width = 0;
  height = 0;
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, Listener>();
  setAttribute(): void {}
  append(): void {}
  replaceChildren(): void {}
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }
  getContext(): object {
    // Every drawing call of the overlay is a no-op.
    return new Proxy({}, { get: () => () => undefined, set: () => true });
  }
  fire(type: string, event: object): void {
    this.listeners.get(type)?.(event);
  }
}

// The light side of Viewer: setDocument and setLook bake unless told not to, relight bakes the shown document, every
// bake reports its start, and a pose is refused while a document is being set. `refuse` is a scene the renderer
// cannot take: the document shown stays.
class FakeViewer {
  doc: SceneDocument | null = null;
  look = 'studio';
  readonly bakes: SceneDocument[] = [];
  /** The look each bake ran under. */
  readonly bakeLooks: string[] = [];
  onBakeStarted: () => void = () => undefined;
  private pending = 0;

  get document(): SceneDocument | null {
    return this.doc;
  }

  get settingDocument(): boolean {
    return this.pending > 0;
  }

  async setDocument(
    next: SceneDocument,
    _reframe: boolean,
    options: { bake?: boolean; delayMs?: number; refuse?: boolean } = {},
  ): Promise<SetSceneResult> {
    this.pending++;
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    } finally {
      this.pending--;
    }
    if (options.refuse) return { applied: false, warnings: [] };
    this.doc = next;
    if (options.bake ?? true) this.bake();
    return { applied: true, warnings: [] };
  }

  setLook(look: string, options: { bake?: boolean } = {}): void {
    this.look = look;
    if (options.bake ?? true) this.bake();
  }

  setPose(next: SceneDocument): Promise<SetSceneResult> {
    if (this.pending > 0) return Promise.resolve({ applied: false, warnings: [] });
    this.doc = next;
    return Promise.resolve({ applied: true, warnings: [] });
  }

  relight(): void {
    this.bake();
  }

  requestRender(): void {}

  private bake(): void {
    if (!this.doc) return;
    this.bakes.push(this.doc);
    this.bakeLooks.push(this.look);
    this.onBakeStarted();
  }
}

const clip: SceneAnimation = {
  name: 'lift',
  loop: 'loop',
  length: 1,
  channels: [
    {
      node: 0,
      property: 'translation',
      keyframes: [
        { time: 0, value: [0, 0, 0], interpolation: 'linear' },
        { time: 1, value: [0, 4, 0], interpolation: 'linear' },
      ],
    },
  ],
};
const animated = doc(
  [node(-1, { meshes: [0] }), node(0, { meshes: [1] })],
  [boxMesh(0), boxMesh(1, [0, 2, 0])],
  [clip],
);
const edit: NodeEdit = { node: 1, translation: [3, 0, 0], rotation: [0, 0, 0] };
const hidden: SceneDocument = {
  ...animated,
  meshes: [animated.meshes[0]!, { ...animated.meshes[1]!, visible: false }],
};
const camera: SceneCamera = {
  position: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 60 },
  near: 0.1,
  far: 100,
};

// Long enough for every debounced relight; promises in between are flushed.
const settle = () => vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS * 5);

interface SceneTiming {
  /** The scene takes this long to set. */
  readonly delayMs?: number;
  /** The scene cannot be built: the document shown stays. */
  readonly refuse?: boolean;
}

function setup(rest: SceneDocument = animated, options: { refuseEdits?: boolean; commitDelayMs?: number } = {}) {
  const viewer = new FakeViewer();
  const selection = new Selection();
  const viewport = new FakeElement();
  let state: EditorState = {
    rest,
    edits: [],
    lock: { lockedNodes: [], lockedMeshes: [] },
    look: { lights: { key: { direction: [0, 1, 0] } } } as unknown as EditorState['look'],
  };
  const layout = {
    state: { overlays: { grid: true, axis: true, stats: false, presets: true, gizmos: true } },
    onChange: () => () => undefined,
  } as unknown as LayoutStore;
  const element = (): HTMLElement => new FakeElement() as unknown as HTMLElement;
  // What App.applySetup does with a scene change (and the look of an Undo or Redo step): set the document without a
  // bake, then decide by sceneBakes whether the document or the look bakes, then tell the tools; a refused scene tells
  // the tools so.
  const apply = async (
    next: Partial<Pick<EditorState, 'rest' | 'edits'>>,
    look?: string,
    timing: SceneTiming = {},
  ): Promise<boolean> => {
    const changed = { ...state, ...next };
    const result = await viewer.setDocument(withNodeEdits(changed.rest, changed.rest, changed.edits), false, {
      bake: false,
      ...timing,
    });
    if (!result.applied) {
      tools.documentRefused();
      return false;
    }
    const bakes = sceneBakes({ sceneChanged: true, lookChanged: look !== undefined, reposes: tools.reposes });
    if (bakes.document) viewer.relight();
    state = changed;
    if (look !== undefined) viewer.setLook(look, { bake: bakes.look });
    tools.documentChanged();
    return true;
  };
  let commits = 0;
  const tools = new EditorTools({
    viewer: viewer as unknown as Viewer,
    selection,
    layout,
    viewport: viewport as unknown as HTMLElement,
    overlay: element() as HTMLCanvasElement,
    timeline: element(),
    stats: element(),
    state: () => state,
    // App.commitNodeEdit: a queued setup change, or one the scene refuses.
    commitEdit: async (change) => {
      commits++;
      if (options.refuseEdits) return false;
      return apply({ edits: setNodeEdit(state.rest, state.edits, change) }, undefined, {
        delayMs: options.commitDelayMs ?? 0,
      });
    },
    interacted: () => undefined,
  });
  viewer.onBakeStarted = () => tools.bakeStarted();
  const commit = async (next: Partial<Pick<EditorState, 'rest' | 'edits'>>, look?: string): Promise<void> => {
    await apply(next, look);
    await settle();
  };
  // What App.selectLook does: applyLook bakes under the new look.
  const pickLook = (look: string): void => viewer.setLook(look);
  // What App.commit does with a model: pause playback, set the document without a bake (taking `delayMs`), bake under
  // the look (applyLook) as soon as it is set, then tell the tools. Resolves the documents it baked and forgets them.
  const open = async (next: SceneDocument = state.rest, delayMs = 0): Promise<SceneDocument[]> => {
    const before = viewer.bakes.length;
    tools.pausePlayback();
    const shown = viewer.setDocument(next, true, { bake: false, delayMs }).then(() => {
      state = { ...state, rest: next, edits: [] };
      viewer.setLook(viewer.look);
      tools.modelChanged();
    });
    await vi.advanceTimersByTimeAsync(delayMs);
    await shown;
    await settle();
    const baked = viewer.bakes.slice(before);
    forget();
    return baked;
  };
  const forget = (): void => {
    viewer.bakes.length = 0;
    viewer.bakeLooks.length = 0;
  };
  // Presses the move handle of node 1's x axis; `drag.move` drags it along the axis, `drag.release` lets go.
  const press = () => {
    selection.set({ kind: 'node', index: 1 });
    tools.resize({ cssWidth: 400, cssHeight: 400, devicePixelRatio: 1 });
    tools.overlay.draw(camera);
    const handle = tools.overlay.handles.find((h) => h.axis === 0);
    const [from, to] = handle?.polyline ?? [];
    if (!from || !to) throw new Error('no x handle');
    const pointer = (x: number, y: number) => ({
      button: 0,
      shiftKey: false,
      isPrimary: true,
      target: null,
      pointerId: 1,
      clientX: x,
      clientY: y,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    viewport.fire('pointerdown', pointer(to.x, to.y));
    return {
      move: () => viewport.fire('pointermove', pointer(2 * to.x - from.x, 2 * to.y - from.y)),
      release: () => viewport.fire('pointerup', pointer(2 * to.x - from.x, 2 * to.y - from.y)),
      cancel: () => viewport.fire('pointercancel', {}),
    };
  };
  const play = async (): Promise<void> => {
    tools.togglePlay();
    frames.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(tools.timeline.playing).toBe(true);
  };
  return {
    viewer,
    tools,
    apply,
    commit,
    open,
    pickLook,
    press,
    play,
    forget,
    state: () => state,
    commits: () => commits,
  };
}

function posed(rest: SceneDocument, edits: readonly NodeEdit[], time: number): SceneDocument {
  return withNodeEdits(animateScene(rest, { animation: 0, time, loop: 'loop' }).document, rest, edits);
}

const translations = (d: SceneDocument | undefined) => d?.nodes.map((n) => n.translation);

let frames: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('document', { createElement: () => new FakeElement(), documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('Element', class {});
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EditorTools light: a scene change', () => {
  it('bakes once at rest: the commit bakes, no relight follows', async () => {
    const { viewer, commit, open } = setup();
    await open();
    await commit({ edits: [edit] });
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[1]?.translation).toEqual([3, 0, 0]);
    await commit({ rest: hidden });
    expect(viewer.bakes).toHaveLength(2);
    expect(viewer.bakes[1]?.meshes[1]?.visible).toBe(false);
    expect(viewer.doc).toEqual(viewer.bakes[1]);
  });

  it('bakes a model without clips once per change', async () => {
    const still = doc(animated.nodes, animated.meshes);
    const { viewer, tools, commit, open } = setup(still);
    await open();
    await commit({ edits: [edit] });
    expect(tools.reposes).toBe(false);
    expect(viewer.bakes).toHaveLength(1);
  });

  it('lights a scrubbed pose once, and once more per scene change: the clip pose, never the rest pose', async () => {
    const { viewer, tools, commit, open, forget } = setup();
    await open();
    tools.timeline.seek(0.5);
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    forget();

    await commit({ edits: [edit] });
    expect(tools.reposes).toBe(true);
    expect(viewer.bakes).toHaveLength(1);
    expect(translations(viewer.bakes[0])).toEqual(translations(posed(animated, [edit], 0.5)));

    await commit({ rest: hidden });
    expect(viewer.bakes).toHaveLength(2);
    expect(viewer.bakes[1]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.bakes[1]?.meshes[1]?.visible).toBe(false);
  });

  it('lights a paused clip pose at once when the scene changes under it, not after the relight delay', async () => {
    const { viewer, tools, apply, open, forget } = setup();
    await open();
    tools.timeline.seek(0.5);
    await settle();
    forget();
    await apply({ rest: hidden });
    await vi.advanceTimersByTimeAsync(0);
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.bakes[0]?.meshes[1]?.visible).toBe(false);
    await settle();
    expect(viewer.bakes).toHaveLength(1);
  });

  it('a scrub while an at-rest scene change is being set bakes that pose once, never the rest pose', async () => {
    const { viewer, tools, apply, open } = setup();
    await open();
    const done = apply({ rest: hidden }, undefined, { delayMs: 100 });
    tools.timeline.seek(0.5);
    await settle();
    expect(await done).toBe(true);
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.bakes[0]?.meshes[1]?.visible).toBe(false);
    expect(viewer.doc).toBe(viewer.bakes[0]);
  });

  it('a scene change that fails while the playhead moves shows the pose it moved to and lights it once', async () => {
    const { viewer, tools, apply, open } = setup();
    await open();
    const done = apply({ rest: hidden }, undefined, { delayMs: 100, refuse: true });
    tools.timeline.seek(0.5);
    await settle();
    expect(await done).toBe(false);
    expect(viewer.doc?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.doc?.meshes[1]?.visible).not.toBe(false);
    expect(viewer.bakes).toEqual([viewer.doc]);
  });

  it('a scene change that fails with the preview at the playhead bakes nothing', async () => {
    const { viewer, tools, apply, open, forget } = setup();
    await open();
    tools.timeline.seek(0.5);
    await settle();
    forget();
    const shown = viewer.doc;
    expect(await apply({ rest: hidden }, undefined, { refuse: true })).toBe(false);
    await settle();
    expect(viewer.bakes).toHaveLength(0);
    expect(viewer.doc).toBe(shown);
  });

  it('a pose at 0 s of a chosen clip is a pose too', async () => {
    const { viewer, tools, commit, open, forget } = setup();
    await open();
    tools.timeline.seek(0);
    await settle();
    forget();
    await commit({ edits: [edit] });
    expect(viewer.bakes).toHaveLength(1);
  });

  it('during playback lights the frame shown at once, then the pose it stops on', async () => {
    const { viewer, tools, commit, open, play } = setup();
    await open();
    await play();
    expect(viewer.bakes).toHaveLength(0);
    await commit({ rest: hidden });
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.meshes[1]?.visible).toBe(false);
    frames.shift()?.();
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    tools.togglePlay();
    await settle();
    expect(viewer.bakes).toHaveLength(2);
    expect(viewer.bakes[1]).toBe(viewer.doc);
  });

  it('an Undo step that changes scene and look bakes once, under the new look, at rest and at a clip pose', async () => {
    const { viewer, tools, commit, open, forget } = setup();
    await open();
    await commit({ edits: [edit] }, 'marketplace');
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakeLooks).toEqual(['marketplace']);
    expect(viewer.bakes[0]?.nodes[1]?.translation).toEqual([3, 0, 0]);

    tools.timeline.seek(0.5);
    await settle();
    forget();
    await commit({ edits: [] }, 'rim');
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakeLooks).toEqual(['rim']);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
  });
});

describe('EditorTools light: a model or a look', () => {
  it('opening another model while a clip plays bakes the new model once, no relight of the stopped pose', async () => {
    const { tools, open, play } = setup();
    await open();
    await play();
    const other = doc(animated.nodes, animated.meshes, [clip]);
    expect(await open(other)).toEqual([other]);
    expect(tools.timeline.playing).toBe(false);
  });

  it('a model that takes longer than the relight delay to set is baked once, the stopped pose never', async () => {
    const { open, play } = setup();
    await open();
    await play();
    const other = doc(animated.nodes, animated.meshes, [clip]);
    expect(await open(other, RELIGHT_DELAY_MS * 3 + 50)).toEqual([other]);
  });

  it('opening a model right after a scrub bakes it once', async () => {
    const { tools, open } = setup();
    await open();
    tools.timeline.seek(0.5);
    await vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS / 2);
    expect(await open(doc(animated.nodes, animated.meshes, [clip]))).toHaveLength(1);
  });

  it('a look picked right after a scrub or a pause bakes once, the pose shown', async () => {
    const { viewer, tools, open, pickLook, play, forget } = setup();
    await open();
    tools.timeline.seek(0.5);
    await vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS / 2);
    pickLook('rim');
    await settle();
    expect(viewer.bakeLooks).toEqual(['rim']);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    forget();

    await play();
    frames.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    tools.togglePlay();
    await vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS / 2);
    pickLook('studio');
    await settle();
    expect(viewer.bakeLooks).toEqual(['studio']);
    expect(viewer.bakes[0]).toBe(viewer.doc);
  });

  it('a look picked during playback bakes that frame, and the pose it stops on is lit once', async () => {
    const { viewer, tools, open, pickLook, play } = setup();
    await open();
    await play();
    pickLook('rim');
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    tools.togglePlay();
    await settle();
    expect(viewer.bakes).toHaveLength(2);
  });
});

describe('EditorTools light: a gizmo drag', () => {
  it('a drag commit at rest bakes once, the moved node', async () => {
    const { viewer, open, press } = setup();
    await open();
    const drag = press();
    drag.move();
    drag.release();
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[1]?.translation[0]).not.toBe(0);
  });

  it('a drag commit at a clip pose bakes once, that pose, at once', async () => {
    const { viewer, tools, open, press, forget } = setup();
    await open();
    tools.timeline.seek(0.5);
    await settle();
    forget();
    const drag = press();
    drag.move();
    drag.release();
    // Lit as soon as the commit lands, like any edit, not a relight delay later like the end of a scrub.
    await vi.advanceTimersByTimeAsync(0);
    expect(viewer.bakes).toHaveLength(1);
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.bakes[0]?.nodes[1]?.translation[0]).not.toBe(0);
  });

  it('a refused commit lights the pose shown again when a relight fell due during the drag', async () => {
    const { viewer, open, press, play } = setup(animated, { refuseEdits: true });
    await open();
    await play();
    const drag = press();
    drag.move();
    await vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS * 2);
    expect(viewer.bakes).toHaveLength(0);
    drag.release();
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]).toBe(viewer.doc);
    expect(viewer.doc?.nodes[1]?.translation).toEqual([0, 0, 0]);
  });

  it('a handle pressed while the last drag is being committed starts no drag', async () => {
    const { viewer, open, press, commits, state } = setup(animated, { commitDelayMs: RELIGHT_DELAY_MS / 2 });
    await open();
    const first = press();
    first.move();
    first.release();
    const second = press();
    second.move();
    second.release();
    await settle();
    expect(commits()).toBe(1);
    expect(state().edits).toHaveLength(1);
    expect(viewer.doc?.nodes[1]?.translation).toEqual(state().edits[0]?.translation);
  });

  it('a refused commit or a cancelled drag over a lit pose bakes nothing', async () => {
    const { viewer, open, press } = setup(animated, { refuseEdits: true });
    await open();
    const refused = press();
    refused.move();
    refused.release();
    await settle();
    const cancelled = press();
    cancelled.move();
    cancelled.cancel();
    await settle();
    expect(viewer.bakes).toHaveLength(0);
  });

  it('a cancelled drag lights the pose shown again when a relight fell due during it', async () => {
    const { viewer, open, press, play } = setup();
    await open();
    await play();
    const drag = press();
    drag.move();
    await vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS * 2);
    drag.cancel();
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]).toBe(viewer.doc);
  });
});

describe('EditorTools dispose', () => {
  it('leaves no relight behind, playing or after a scrub', async () => {
    const playing = setup();
    await playing.open();
    await playing.play();
    playing.tools.dispose();
    await settle();
    expect(playing.viewer.bakes).toHaveLength(0);

    const scrubbed = setup();
    await scrubbed.open();
    scrubbed.tools.timeline.seek(0.5);
    await vi.advanceTimersByTimeAsync(0);
    scrubbed.tools.dispose();
    await settle();
    expect(scrubbed.viewer.bakes).toHaveLength(0);
  });
});
