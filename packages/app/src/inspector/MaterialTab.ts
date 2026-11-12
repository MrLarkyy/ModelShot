import type { SceneDocument, SceneTexture, SceneTextureFilter } from '@modelshot/scene';
import { displayName } from '../editor/displayName';
import type { InspectorTabId } from '../layout/layoutState';
import { el, uniqueId } from '../ui/dom';
import { section } from '../ui/section';
import type { SectionState } from '../ui/sectionState';
import type { InspectorModel } from './InspectorModel';
import { materialState, type MaterialInfo } from './materialState';

export interface MaterialTabHost {
  readonly setTextureFilter: (index: number, filter: SceneTextureFilter) => void;
  /** Selects a node or element, as the outliner does. */
  readonly selectRow: (kind: 'node' | 'mesh', index: number) => void;
  /** Shows another inspector tab. */
  readonly showTab: (tab: InspectorTabId) => void;
}

/** Textures listed with a filter control; a larger set lists the first ones. */
export const MAX_FILTER_ROWS = 500;

/** Longest side of a texture thumbnail in device-independent pixels. */
const THUMB_PX = 64;

// Decoded once per texture image and kept as long as the image lives; a bitmap never reaches the network and a canvas
// needs no `img-src` (the page policy allows images from the page's own origin only).
const thumbnails = new WeakMap<Uint8Array, Promise<ImageBitmap | null>>();

function decodeThumbnail(texture: SceneTexture): Promise<ImageBitmap | null> {
  const { bytes } = texture;
  if (!bytes || typeof createImageBitmap !== 'function') return Promise.resolve(null);
  let pending = thumbnails.get(bytes);
  if (!pending) {
    const scale = Math.min(1, (THUMB_PX * 2) / Math.max(texture.width, texture.height, 1));
    pending = createImageBitmap(new Blob([bytes as BlobPart], { type: texture.mimeType }), {
      resizeWidth: Math.max(1, Math.round(texture.width * scale)),
      resizeHeight: Math.max(1, Math.round(texture.height * scale)),
      resizeQuality: 'pixelated',
    }).catch(() => null);
    thumbnails.set(bytes, pending);
  }
  return pending;
}

function thumbnail(texture: SceneTexture): HTMLElement {
  const canvas = el('canvas', {
    className: 'texture-thumb',
    attributes: { role: 'img', 'aria-label': `Texture ${texture.name || 'image'}` },
  });
  const fit = Math.min(THUMB_PX / Math.max(texture.width, 1), THUMB_PX / Math.max(texture.height, 1));
  canvas.width = Math.max(1, Math.round(texture.width * fit));
  canvas.height = Math.max(1, Math.round(texture.height * fit));
  void decodeThumbnail(texture).then((bitmap) => {
    const context = canvas.getContext('2d');
    if (!bitmap || !context) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  });
  return canvas;
}

function segmented(
  label: string,
  focus: string,
  value: SceneTextureFilter,
  onChange: (filter: SceneTextureFilter) => void,
): HTMLElement {
  const group = uniqueId('filter');
  const radio = (filter: SceneTextureFilter, text: string): HTMLLabelElement => {
    const input = el('input', {
      attributes: { type: 'radio', name: group, value: filter, 'data-focus': `${focus}:${filter}` },
    });
    input.checked = value === filter;
    input.addEventListener('change', () => {
      if (input.checked) onChange(filter);
    });
    return el('label', { className: 'segment' }, [input, el('span', { text })]);
  };
  return el('fieldset', { className: 'segmented', attributes: { 'aria-label': label } }, [
    radio('nearest', 'Nearest'),
    radio('linear', 'Linear'),
  ]);
}

function filterRows(model: InspectorModel, host: MaterialTabHost, indices: readonly number[]): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const index of indices) {
    const texture = model.doc.textures[index];
    if (!texture || texture.missing || rows.length >= MAX_FILTER_ROWS) continue;
    const name = texture.name || `Texture ${index + 1}`;
    rows.push(
      el('div', { className: 'field' }, [
        el('span', { text: name }),
        segmented(`Filter ${name}`, `filter:${index}`, model.textureFilter[index] ?? 'nearest', (filter) =>
          host.setTextureFilter(index, filter),
        ),
      ]),
    );
  }
  if (rows.length === 0) return [el('p', { className: 'hint', text: 'This model has no texture to filter.' })];
  return [
    ...rows,
    el('p', { className: 'hint', text: 'Nearest keeps pixel art crisp; Linear smooths between texels.' }),
  ];
}

function textureRows(doc: SceneDocument, materials: readonly MaterialInfo[]): HTMLElement[] {
  const rows = materials.map((material) => {
    const texture = material.texture >= 0 ? doc.textures[material.texture] : undefined;
    const head = el('strong', { text: material.name });
    if (!texture)
      return el('div', { className: 'texture-row' }, [head, el('span', { className: 'hint', text: 'No texture.' })]);
    if (texture.missing) {
      return el('div', { className: 'texture-row' }, [
        head,
        el('span', { className: 'hint', text: `${texture.name || 'Texture'} is missing from the files you opened.` }),
      ]);
    }
    return el('div', { className: 'texture-row' }, [
      thumbnail(texture),
      el('div', {}, [
        head,
        el('div', { text: texture.name || `Texture ${material.texture + 1}` }),
        el('div', { className: 'hint', text: `${texture.width} × ${texture.height} px` }),
      ]),
    ]);
  });
  return rows.length > 0 ? rows : [el('p', { className: 'hint', text: 'This element uses the default material.' })];
}

function transparencyRows(materials: readonly MaterialInfo[]): HTMLElement[] {
  const rows = materials.map((m) =>
    el('dl', {}, [
      el('dt', { text: 'Material' }),
      el('dd', { text: m.name }),
      el('dt', { text: 'Alpha mode' }),
      el('dd', { text: m.alphaMode }),
      ...(m.cutoff === null
        ? []
        : [el('dt', { text: 'Cut-out below' }), el('dd', { text: `${Math.round(m.cutoff * 100)} % alpha` })]),
      el('dt', { text: 'Alpha emission' }),
      el('dd', { text: m.alphaEmission ? 'On' : 'Off' }),
      el('dt', { text: 'Blending' }),
      el('dd', { text: m.blending }),
      el('dt', { text: 'Sides' }),
      el('dd', { text: m.sides }),
    ]),
  );
  return [...rows, el('p', { className: 'hint', text: 'From the file.' })];
}

// The Material tab: for an element its textures, texture filtering, transparency and edge rounding; for a group the
// elements it holds, each one a button that selects it. Only the texture filter is editable: the rest comes from the
// file or the look, and is shown as that.
export function buildMaterialTab(
  model: InspectorModel | null,
  host: MaterialTabHost,
  sections: SectionState,
): HTMLElement[] {
  if (!model) return [el('p', { className: 'hint', text: 'Open a model to edit its objects, materials and light.' })];
  const state = materialState(model.doc, model.selection);
  const allTextures = model.doc.textures.map((_, index) => index);
  if (state.kind === 'none') {
    return [
      el('p', {
        className: 'hint',
        text: 'Select an element or a group in the outliner or the 3D view to see its materials.',
      }),
      section('material-filtering', 'Texture filtering', filterRows(model, host, allTextures), sections),
    ];
  }
  if (state.kind === 'group') {
    const rows = state.elements.map((element) => {
      const name = displayName(model.doc, model.names, 'mesh', element.mesh);
      const button = el(
        'button',
        { className: 'ghost', attributes: { type: 'button', 'aria-label': `Select ${name}` } },
        [el('span', { text: name })],
      );
      button.addEventListener('click', () => host.selectRow('mesh', element.mesh));
      const materials = element.materials.length > 0 ? element.materials.join(', ') : 'Default material';
      return el('li', { className: 'element-row' }, [button, el('span', { className: 'hint', text: materials })]);
    });
    const body: HTMLElement[] =
      state.total === 0
        ? [el('p', { className: 'hint', text: 'This group holds no elements.' })]
        : [
            el('p', {
              className: 'hint',
              text:
                state.total > state.elements.length
                  ? `Showing ${state.elements.length} of ${state.total} elements. Choose one to see its material.`
                  : `${state.total} element${state.total === 1 ? '' : 's'}. Choose one to see its material.`,
            }),
            el('ul', { className: 'element-list' }, rows),
          ];
    return [
      section('material-group', 'Group', body, sections),
      section('material-filtering', 'Texture filtering', filterRows(model, host, allTextures), sections),
    ];
  }
  const used = [...new Set(state.materials.map((m) => m.texture).filter((texture) => texture >= 0))];
  const { edges } = model.look;
  const change = el('button', { className: 'small', attributes: { type: 'button' }, text: 'Change in Look' });
  change.addEventListener('click', () => host.showTab('look'));
  return [
    section('material-texture', 'Texture', textureRows(model.doc, state.materials), sections),
    section('material-filtering', 'Filtering', filterRows(model, host, used), sections),
    section('material-transparency', 'Transparency', transparencyRows(state.materials), sections),
    section(
      'material-edges',
      'Edges',
      [
        el('dl', {}, [
          el('dt', { text: 'Rounding' }),
          el('dd', { text: edges.width.toFixed(2) }),
          el('dt', { text: 'Sharp from' }),
          el('dd', { text: `${edges.sharpAngleDeg}°` }),
        ]),
        el('p', { className: 'hint', text: `From the ${model.look.name} look.` }),
        change,
      ],
      sections,
    ),
    el('p', { className: 'hint', text: 'Preview and render use the same values.' }),
  ];
}
