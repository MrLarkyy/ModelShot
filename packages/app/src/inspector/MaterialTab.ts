import type { SceneTextureFilter } from '@modelshot/scene';
import { displayName } from '../editor/displayName';
import { el } from '../ui/dom';
import type { InspectorModel } from './InspectorModel';

export interface MaterialTabHost {
  readonly setTextureFilter: (index: number, filter: SceneTextureFilter) => void;
}

/** Textures listed with a filter control; a larger set lists the first ones. */
export const MAX_FILTER_ROWS = 500;

function filterControl(model: InspectorModel, host: MaterialTabHost): HTMLElement | null {
  const rows: HTMLElement[] = [];
  model.doc.textures.forEach((texture, index) => {
    if (texture.missing || rows.length >= MAX_FILTER_ROWS) return;
    const select = el('select');
    select.append(
      el('option', { text: 'Nearest (pixel art)', attributes: { value: 'nearest' } }),
      el('option', { text: 'Linear (smooth)', attributes: { value: 'linear' } }),
    );
    select.value = model.textureFilter[index] ?? 'nearest';
    select.addEventListener('change', () => {
      host.setTextureFilter(index, select.value === 'linear' ? 'linear' : 'nearest');
    });
    const name = texture.name || `Texture ${index + 1}`;
    rows.push(el('label', { className: 'field' }, [el('span', { text: name }), select]));
  });
  return rows.length > 0 ? el('fieldset', {}, [el('legend', { text: 'Texture filtering' }), ...rows]) : null;
}

// The Material tab: the materials the selected element draws with (read from the file) and the texture filtering.
export function buildMaterialTab(model: InspectorModel | null, host: MaterialTabHost): HTMLElement[] {
  if (!model) return [el('p', { className: 'hint', text: 'No model open.' })];
  const parts: HTMLElement[] = [];
  const target = model.selection;
  const mesh = target?.kind === 'mesh' ? model.doc.meshes[target.index] : undefined;
  if (target && mesh) {
    parts.push(el('h3', { text: displayName(model.doc, model.names, 'mesh', target.index) }));
    const seen = new Set<number>();
    for (const group of mesh.groups) {
      const material = model.doc.materials[group.material];
      if (!material || seen.has(group.material)) continue;
      seen.add(group.material);
      parts.push(
        el('dl', {}, [
          el('dt', { text: 'Material' }),
          el('dd', { text: material.name || `Material ${group.material + 1}` }),
          el('dt', { text: 'Alpha mode' }),
          el('dd', { text: material.alphaMode ?? 'opaque' }),
          el('dt', { text: 'Blending' }),
          el('dd', { text: material.blending ?? 'normal' }),
          el('dt', { text: 'Sides' }),
          el('dd', { text: group.doubleSided === true ? 'Both' : 'Front' }),
        ]),
      );
    }
    if (seen.size === 0) parts.push(el('p', { className: 'hint', text: 'This element uses the default material.' }));
  } else {
    parts.push(el('p', { className: 'hint', text: 'Select an element to see its material.' }));
  }
  const filters = filterControl(model, host);
  if (filters) parts.push(filters);
  return parts;
}
