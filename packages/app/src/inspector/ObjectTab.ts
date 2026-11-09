import { MAX_ANIMATION_VALUE, type Vec3 } from '@modelshot/scene';
import { displayName, MAX_NAME_LENGTH } from '../editor/displayName';
import { isMeshLocked, isNodeLocked } from '../editor/isLocked';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import { nodeTransform } from '../session/withNodeEdits';
import { el, labelled, uniqueId } from '../ui/dom';
import type { InspectorModel } from './InspectorModel';

export interface ObjectTabHost {
  readonly rename: (kind: 'node' | 'mesh', index: number, name: string) => void;
  readonly setVisible: (kind: 'node' | 'mesh', index: number, visible: boolean) => void;
  readonly setLocked: (kind: 'node' | 'mesh', index: number, locked: boolean) => void;
  readonly setTransform: (node: number, translation: Vec3, rotation: Vec3) => void;
  readonly setArms: (arms: PlayerArmsChoice) => void;
}

const AXES = ['X', 'Y', 'Z'] as const;

function armsControl(arms: PlayerArmsChoice, onChange: (arms: PlayerArmsChoice) => void): HTMLElement {
  const group = uniqueId('arms');
  const radio = (value: PlayerArmsChoice, label: string): HTMLLabelElement => {
    const input = el('input', { attributes: { type: 'radio', name: group, value } });
    input.checked = arms === value;
    input.addEventListener('change', () => {
      if (input.checked) onChange(value);
    });
    return el('label', { className: 'choice' }, [input, el('span', { text: label })]);
  };
  return el('fieldset', {}, [
    el('legend', { text: 'Arms' }),
    radio('classic', 'Classic (4 px)'),
    radio('slim', 'Slim (3 px)'),
  ]);
}

// The Object tab: label, visibility and lock of the selected node or element, the position and rotation of its node,
// and the player arms of a skin.
export function buildObjectTab(model: InspectorModel | null, host: ObjectTabHost): HTMLElement[] {
  if (!model) return [el('p', { className: 'hint', text: 'No model open.' })];
  const parts: HTMLElement[] = [];
  const target = model.selection;
  if (model.player) parts.push(armsControl(model.player.arms, host.setArms));
  if (!target) {
    parts.unshift(el('p', { className: 'hint', text: 'Select a node or element in the outliner or the 3D view.' }));
    return parts;
  }
  const { doc } = model;
  const { kind, index } = target;
  const node = kind === 'node' ? index : (doc.meshes[index]?.node ?? -1);
  const locked = kind === 'node' ? isNodeLocked(doc, model, index) : isMeshLocked(doc, model, index);

  const name = el('input', { attributes: { type: 'text', maxlength: String(MAX_NAME_LENGTH) } });
  name.value = displayName(doc, model.names, kind, index);
  name.addEventListener('change', () => {
    const typed = name.value.trim().slice(0, MAX_NAME_LENGTH);
    const original = (kind === 'node' ? doc.nodes[index]?.name : doc.meshes[index]?.name) ?? '';
    host.rename(kind, index, typed === original ? '' : typed);
  });
  const visible = el('input', { attributes: { type: 'checkbox' } });
  visible.checked = (kind === 'node' ? model.nodeVisible : model.meshVisible)[index] === true;
  visible.addEventListener('change', () => host.setVisible(kind, index, visible.checked));
  const lock = el('input', { attributes: { type: 'checkbox' } });
  lock.checked = (kind === 'node' ? model.lockedNodes : model.lockedMeshes)[index] === true;
  lock.addEventListener('change', () => host.setLocked(kind, index, lock.checked));
  parts.unshift(
    el('h3', { text: kind === 'node' ? 'Group' : 'Element' }),
    labelled('Name', name),
    el('label', { className: 'choice' }, [visible, el('span', { text: 'Visible' })]),
    el('label', { className: 'choice' }, [lock, el('span', { text: 'Locked' })]),
  );

  const transform = node >= 0 ? nodeTransform(doc, model.edits, node) : null;
  if (!transform) {
    parts.push(el('p', { className: 'hint', text: 'This element is not inside a group, so it has no transform.' }));
    return parts;
  }
  const position = AXES.map((axis, i) => numberField(`Position ${axis}`, transform.translation[i] ?? 0, 0.1));
  const rotation = AXES.map((axis, i) => numberField(`Rotation ${axis}`, transform.rotation[i] ?? 0, 1));
  const send = (): void => {
    const read = (fields: ReturnType<typeof numberField>[]): Vec3 | null => {
      const values = fields.map((f) => Number(f.input.value));
      if (values.some((v) => !Number.isFinite(v) || Math.abs(v) > MAX_ANIMATION_VALUE)) return null;
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
    };
    const t = read(position);
    const r = read(rotation);
    if (!t || !r) {
      position.forEach((f, i) => (f.input.value = String(transform.translation[i] ?? 0)));
      rotation.forEach((f, i) => (f.input.value = String(transform.rotation[i] ?? 0)));
      return;
    }
    host.setTransform(node, t, r);
  };
  for (const field of [...position, ...rotation]) {
    field.input.disabled = locked;
    field.input.addEventListener('change', send);
  }
  parts.push(
    el('h3', { text: 'Position' }),
    ...position.map((f) => f.label),
    el('h3', { text: 'Rotation (degrees)' }),
    ...rotation.map((f) => f.label),
  );
  if (locked) parts.push(el('p', { className: 'hint', text: 'Locked: unlock it to change the transform.' }));
  return parts;
}

function numberField(label: string, value: number, step: number): { input: HTMLInputElement; label: HTMLLabelElement } {
  const input = el('input', { attributes: { type: 'number', step: String(step) } });
  input.value = String(Math.round(value * 1e4) / 1e4);
  return { input, label: labelled(label, input) };
}
