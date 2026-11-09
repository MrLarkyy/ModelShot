import { animateScene, type SceneAnimation, type SceneDocument } from '@modelshot/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '../src/export/ExportDialog';
import { DEFAULT_EXPORT_SETTINGS, type ExportKind } from '../src/export/ExportSettings';
import type { NodeEdit } from '../src/session/NodeEdit';
import { editPose } from '../src/session/editPose';
import { withNodeEdits } from '../src/session/withNodeEdits';
import { boxMesh, doc, node } from './editorDocs';

const result = { blob: new Blob([]), extension: 'png', width: 8, height: 8, frames: 1, warnings: [] };
const lib = vi.hoisted(() => ({
  MAX_EXPORT_SIDE: 4096,
  MAX_CLIP_FPS: 60,
  MAX_CLIP_FRAMES: 240,
  ExportError: class extends Error {},
  checkExportOptions: () => undefined,
  exportStill: vi.fn(),
  exportClip: vi.fn(),
}));
vi.mock('../src/loadExport', () => ({ loadExport: () => Promise.resolve(lib) }));
vi.mock('../src/export/downloadBlob', () => ({ downloadBlob: () => 'model-modelshot.png' }));

// Just enough of an element for the dialog's form in a Node test: the Export button is found by its text and clicked.
class FakeElement {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  value = '';
  checked = false;
  title = '';
  open = false;
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly tag: string) {}
  setAttribute(): void {}
  append(...children: (FakeElement | string)[]): void {
    for (const child of children) if (typeof child !== 'string') this.children.push(child);
  }
  replaceChildren(...children: FakeElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
  querySelector(): null {
    return null;
  }
  showModal(): void {
    this.open = true;
  }
  close(): void {
    this.open = false;
  }
  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
  find(tag: string, text: string): FakeElement | undefined {
    if (this.tag === tag && this.textContent === text) return this;
    for (const child of this.children) {
      const found = child.find(tag, text);
      if (found) return found;
    }
    return undefined;
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
const rest = doc([node(-1, { meshes: [0] }), node(0, { meshes: [1] })], [boxMesh(0), boxMesh(1, [0, 2, 0])], [clip]);
const edits: NodeEdit[] = [
  { node: 0, translation: [1, 0, 0], rotation: [0, 30, 0] },
  { node: 1, translation: [0, 0, 2], rotation: [0, 0, 0] },
];
const shown = withNodeEdits(animateScene(rest, { animation: 0, time: 0.5 }).document, rest, edits);

async function exportAs(kind: ExportKind, withEdits: readonly NodeEdit[] = edits): Promise<void> {
  const dialog = new FakeElement('dialog');
  const exporter = new ExportDialog(dialog as unknown as HTMLDialogElement, {
    document: () => shown,
    restDocument: () => rest,
    editPose: () => editPose(rest, withEdits),
    modelName: () => 'model',
    camera: () => ({}) as never,
    viewportAspect: () => 1,
    tracer: () => Promise.resolve({} as never),
    settings: () => ({ ...DEFAULT_EXPORT_SETTINGS, kind, clipFormat: 'apng' }),
    onSettings: () => undefined,
    begin: () => true,
    end: () => undefined,
  });
  await exporter.open();
  const button = dialog.find('button', 'Export');
  expect(button, 'the Export button').toBeDefined();
  button?.click();
  await vi.waitFor(() => expect(lib.exportStill.mock.calls.length + lib.exportClip.mock.calls.length).toBe(1));
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) });
  lib.exportStill.mockReset().mockResolvedValue(result);
  lib.exportClip.mockReset().mockResolvedValue(result);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExportDialog with node edits', () => {
  it('an animation clip animates the rest pose and puts the edits on every frame', async () => {
    await exportAs('animation');
    const [, from, options, run] = lib.exportClip.mock.calls[0] as [
      unknown,
      SceneDocument,
      { kind: string },
      { pose?: (frame: SceneDocument) => SceneDocument },
    ];
    expect(from).toBe(rest);
    expect(options.kind).toBe('animation');
    expect(run.pose).toBeTypeOf('function');
    for (const time of [0, 0.5]) {
      const frame = animateScene(rest, { animation: 0, time, loop: 'loop' }).document;
      expect(run.pose?.(frame)).toEqual(withNodeEdits(frame, rest, edits));
    }
  });

  it('an animation clip without edits has no pose step', async () => {
    await exportAs('animation', []);
    const run = lib.exportClip.mock.calls[0]?.[3] as { pose?: unknown };
    expect(run).not.toHaveProperty('pose');
  });

  it('a turntable is made from the shown document, edits already in it, without a pose step', async () => {
    await exportAs('turntable');
    const [, from, options, run] = lib.exportClip.mock.calls[0] as [unknown, SceneDocument, { kind: string }, object];
    expect(from).toBe(shown);
    expect(options.kind).toBe('turntable');
    expect(run).not.toHaveProperty('pose');
  });

  it('a still is made from the shown document and never sees a pose step', async () => {
    await exportAs('still');
    expect(lib.exportClip).not.toHaveBeenCalled();
    const [, from, options, run] = lib.exportStill.mock.calls[0] as [unknown, SceneDocument, { kind: string }, object];
    expect(from).toBe(shown);
    expect(options.kind).toBe('still');
    expect(run).not.toHaveProperty('pose');
  });
});
