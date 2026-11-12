import { loadBbmodel } from '@modelshot/formats';
import { ScenePanel, type ScenePanelModel } from '../../../../packages/app/src/panels/ScenePanel';
import '../../../../packages/app/src/app.css';
import type { MsFixture } from './fixtureApi';

const GROUPS = 100;
const PARTS = 19;

// 100 groups of 19 sub-groups, each holding one cube: 2000 nodes and 1900 cubes, about four times the rows the list shows.
function model(): ScenePanelModel {
  const elements: unknown[] = [];
  const outliner: unknown[] = [];
  let id = 0;
  for (let g = 0; g < GROUPS; g++) {
    const children: unknown[] = [];
    for (let s = 0; s < PARTS; s++) {
      const uuid = `c-${id++}`;
      elements.push({
        name: `cube ${uuid}`,
        from: [g, s, 0],
        to: [g + 1, s + 1, 1],
        origin: [g, s, 0],
        faces: { north: { uv: [0, 0, 1, 1], texture: false } },
        type: 'cube',
        uuid,
      });
      children.push({ name: `part ${g}-${s}`, origin: [0, 0, 0], uuid: `g-${g}-${s}`, children: [uuid] });
    }
    outliner.push({ name: `group ${g}`, origin: [0, 0, 0], uuid: `g-${g}`, children });
  }
  const source = JSON.stringify({
    meta: { format_version: '4.9', model_format: 'bedrock', box_uv: false },
    name: 'big',
    resolution: { width: 16, height: 16 },
    elements,
    outliner,
  });
  const doc = loadBbmodel(source).scene;
  return {
    doc,
    nodeVisible: doc.nodes.map(() => true),
    meshVisible: doc.meshes.map(() => true),
    lockedNodes: doc.nodes.map(() => false),
    lockedMeshes: doc.meshes.map(() => false),
    names: new Map(),
  };
}

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const root = document.getElementById('scene-panel') as HTMLElement;
const menu = document.getElementById('add-menu') as HTMLElement;
const scene = model();
const panel = new ScenePanel(
  root,
  {
    setNodeVisible: () => undefined,
    setMeshVisible: () => undefined,
    selectRow: () => undefined,
    setLocked: () => undefined,
    rename: () => undefined,
    selectLight: () => undefined,
    openFiles: () => undefined,
  },
  menu,
);
panel.show(scene);

// Each step is its own task, followed by a frame: the handler, then the style and layout of the rebuilt rows (the
// offsetHeight read forces both inside the task), which is what the user waits for.
async function step(run: () => void): Promise<void> {
  run();
  void document.body.offsetHeight;
  await frame();
}

const search = root.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
const typeSearch = (value: string) => (): void => {
  search.value = value;
  search.dispatchEvent(new Event('input', { bubbles: true }));
};
const menuItem = (label: string): HTMLElement => {
  const more = document.querySelector<HTMLElement>('#scene-panel .menu button[aria-controls]') as HTMLElement;
  if (more.getAttribute('aria-expanded') !== 'true') more.click();
  const found = [...document.querySelectorAll<HTMLElement>('#scene-panel .menu-list button')].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no "${label}" in the outliner menu`);
  return found;
};

const api: MsFixture = {
  ready: frame(),
  renderer: 'dom',
  floatRenderTargets: false,
  width: 0,
  height: 0,
  samplesDone: 0,
  readRGBA: () => '',
  outliner: {
    nodes: scene.doc.nodes.length,
    meshes: scene.doc.meshes.length,
    rows: () => root.querySelectorAll('[role="treeitem"]').length,
    async rebuildAll() {
      await step(typeSearch('part 1'));
      await step(typeSearch('part 12-3'));
      await step(typeSearch(''));
      await step(() => menuItem('Collapse all').click());
      await step(() => menuItem('Expand all').click());
      await step(() => panel.show(scene));
    },
  },
};
window.__msFixture = api;
