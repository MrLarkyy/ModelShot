import { animateScene, type SceneAnimation, type SceneDocument } from '@modelshot/scene';
import type { SetSceneResult } from '@modelshot/renderer-rt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTools, RELIGHT_DELAY_MS, type EditorState } from '../src/editor/EditorTools';
import { Selection } from '../src/editor/Selection';
import type { LayoutStore } from '../src/layout/LayoutStore';
import type { NodeEdit } from '../src/session/NodeEdit';
import { sceneBakes } from '../src/session/sceneBakes';
import { withNodeEdits } from '../src/session/withNodeEdits';
import type { Viewer } from '../src/viewer/Viewer';
import { boxMesh, doc, node } from './editorDocs';

// Just enough of an element for the timeline, the overlay canvas and the viewport in a Node test.
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
  setAttribute(): void {}
  append(): void {}
  replaceChildren(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
  getContext(): object {
    return {};
  }
}

// The light side of Viewer: setDocument and setLook bake unless told not to, relight bakes the shown document.
class FakeViewer {
  doc: SceneDocument | null = null;
  look = 'studio';
  readonly bakes: SceneDocument[] = [];
  /** The look each bake ran under. */
  readonly bakeLooks: string[] = [];

  get document(): SceneDocument | null {
    return this.doc;
  }

  setDocument(next: SceneDocument, _reframe: boolean, options: { bake?: boolean } = {}): Promise<SetSceneResult> {
    this.doc = next;
    if (options.bake ?? true) this.bake();
    return Promise.resolve({ applied: true, warnings: [] });
  }

  setLook(look: string, options: { bake?: boolean } = {}): void {
    this.look = look;
    if (options.bake ?? true) this.bake();
  }

  setPose(next: SceneDocument): Promise<SetSceneResult> {
    this.doc = next;
    return Promise.resolve({ applied: true, warnings: [] });
  }

  relight(): void {
    this.bake();
  }

  private bake(): void {
    if (!this.doc) return;
    this.bakes.push(this.doc);
    this.bakeLooks.push(this.look);
  }

  requestRender(): void {}
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

function setup(rest: SceneDocument = animated) {
  const viewer = new FakeViewer();
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
  const tools = new EditorTools({
    viewer: viewer as unknown as Viewer,
    selection: new Selection(),
    layout,
    viewport: element(),
    overlay: element() as HTMLCanvasElement,
    timeline: element(),
    stats: element(),
    state: () => state,
    commitEdit: () => Promise.resolve(true),
    interacted: () => undefined,
  });
  // What App.applySetup does with a scene change (and the look of an Undo or Redo step): set the document, then the
  // look, each baking as sceneBakes says, then tell the tools.
  const commit = async (next: Partial<Pick<EditorState, 'rest' | 'edits'>>, look?: string): Promise<void> => {
    const changed = { ...state, ...next };
    const bakes = sceneBakes({ sceneChanged: true, lookChanged: look !== undefined, reposes: tools.reposes });
    await viewer.setDocument(withNodeEdits(changed.rest, changed.rest, changed.edits), false, {
      bake: bakes.document,
    });
    state = changed;
    if (look !== undefined) viewer.setLook(look, { bake: bakes.look });
    tools.documentChanged();
    await settle();
  };
  // What App.commit does with a model (its one bake is applyLook's): show it, then tell the tools; resolves the bakes it
  // cost and forgets them.
  const open = async (next: SceneDocument = state.rest): Promise<number> => {
    const before = viewer.bakes.length;
    state = { ...state, rest: next, edits: [] };
    await viewer.setDocument(next, true);
    tools.modelChanged();
    await settle();
    const bakes = viewer.bakes.length - before;
    viewer.bakes.length = 0;
    viewer.bakeLooks.length = 0;
    return bakes;
  };
  return { viewer, tools, commit, open, state: () => state };
}

// Long enough for every debounced relight; promises in between are flushed.
const settle = () => vi.advanceTimersByTimeAsync(RELIGHT_DELAY_MS * 5);

function posed(rest: SceneDocument, edits: readonly NodeEdit[], time: number): SceneDocument {
  return withNodeEdits(animateScene(rest, { animation: 0, time, loop: 'loop' }).document, rest, edits);
}

let frames: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EditorTools light', () => {
  it('bakes once per scene change at rest: the commit bakes, no relight follows', async () => {
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
    const { viewer, tools, commit, open } = setup();
    await open();
    tools.timeline.seek(0.5);
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    viewer.bakes.length = 0;

    await commit({ edits: [edit] });
    expect(tools.reposes).toBe(true);
    expect(viewer.bakes).toHaveLength(1);
    const expected = posed(animated, [edit], 0.5);
    expect(viewer.bakes[0]?.nodes.map((n) => n.translation)).toEqual(expected.nodes.map((n) => n.translation));

    await commit({ rest: hidden });
    expect(viewer.bakes).toHaveLength(2);
    expect(viewer.bakes[1]?.nodes[0]?.translation).toEqual([0, 2, 0]);
    expect(viewer.bakes[1]?.meshes[1]?.visible).toBe(false);
  });

  it('a pose at 0 s of a chosen clip is a pose too', async () => {
    const { viewer, tools, commit, open } = setup();
    await open();
    tools.timeline.seek(0);
    await settle();
    viewer.bakes.length = 0;
    await commit({ edits: [edit] });
    expect(viewer.bakes).toHaveLength(1);
  });

  it('bakes nothing while a clip plays and lights the pose it stops on once', async () => {
    const { viewer, tools, commit, open } = setup();
    await open();
    tools.togglePlay();
    frames.shift()?.();
    await settle();
    expect(tools.timeline.playing).toBe(true);
    await commit({ edits: [edit] });
    await commit({ rest: hidden });
    expect(viewer.bakes).toHaveLength(0);
    tools.togglePlay();
    await settle();
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakes[0]).toBe(viewer.doc);
  });

  it('an Undo step that changes scene and look bakes once, under the new look, at rest and at a clip pose', async () => {
    const { viewer, tools, commit, open } = setup();
    await open();
    await commit({ edits: [edit] }, 'marketplace');
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakeLooks).toEqual(['marketplace']);
    expect(viewer.bakes[0]?.nodes[1]?.translation).toEqual([3, 0, 0]);

    tools.timeline.seek(0.5);
    await settle();
    viewer.bakes.length = 0;
    viewer.bakeLooks.length = 0;
    await commit({ edits: [] }, 'rim');
    expect(viewer.bakes).toHaveLength(1);
    expect(viewer.bakeLooks).toEqual(['rim']);
    expect(viewer.bakes[0]?.nodes[0]?.translation).toEqual([0, 2, 0]);
  });

  it('opening another model while a clip plays bakes the new model once, no relight of the stopped pose', async () => {
    const { tools, open } = setup();
    await open();
    tools.togglePlay();
    frames.shift()?.();
    await settle();
    expect(tools.timeline.playing).toBe(true);
    const other = doc(animated.nodes, animated.meshes, [clip]);
    expect(await open(other)).toBe(1);
    expect(tools.timeline.playing).toBe(false);
  });
});
