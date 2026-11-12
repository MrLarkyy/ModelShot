import type { SceneAnimation, Vec3 } from '@modelshot/scene';
import { displayName, MAX_NAME_LENGTH } from '../editor/displayName';
import { isMeshLocked, isNodeLocked } from '../editor/isLocked';
import type { PlayerArmsChoice } from '../intake/LoadMessages';
import { nodeTransform } from '../session/withNodeEdits';
import { keyframeTimes } from '../timeline/keyframeTimes';
import { el, uniqueId } from '../ui/dom';
import { icon } from '../ui/icon';
import { section } from '../ui/section';
import type { SectionState } from '../ui/sectionState';
import { xyzField } from '../ui/xyzField';
import type { InspectorModel } from './InspectorModel';

export interface ObjectTabHost {
  readonly rename: (kind: 'node' | 'mesh', index: number, name: string) => void;
  readonly setVisible: (kind: 'node' | 'mesh', index: number, visible: boolean) => void;
  readonly setLocked: (kind: 'node' | 'mesh', index: number, locked: boolean) => void;
  readonly setTransform: (node: number, translation: Vec3, rotation: Vec3) => void;
  readonly setArms: (arms: PlayerArmsChoice) => void;
  /** Moves the playhead to `time` seconds in the shown clip. */
  readonly seek: (time: number) => void;
}

/** Most keyframe buttons listed for one node; the timeline's markers show the rest. */
export const MAX_KEYFRAME_BUTTONS = 24;

function armsControl(arms: PlayerArmsChoice, onChange: (arms: PlayerArmsChoice) => void): HTMLElement {
  const group = uniqueId('arms');
  const radio = (value: PlayerArmsChoice, label: string): HTMLLabelElement => {
    const input = el('input', { attributes: { type: 'radio', name: group, value, 'data-focus': `arms:${value}` } });
    input.checked = arms === value;
    input.addEventListener('change', () => {
      if (input.checked) onChange(value);
    });
    return el('label', { className: 'segment' }, [input, el('span', { text: label })]);
  };
  return el('fieldset', { className: 'segmented', attributes: { 'aria-label': 'Arms' } }, [
    radio('classic', 'Classic (4 px)'),
    radio('slim', 'Slim (3 px)'),
  ]);
}

function toggle(label: string, checked: boolean, focus: string, onChange: (value: boolean) => void): HTMLElement {
  const input = el('input', { attributes: { type: 'checkbox', 'data-focus': focus } });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { className: 'toggle-row' }, [el('span', { text: label }), input]);
}

/** The keyframe times (seconds) of the channels that move `node` in `clip`, ascending. */
export function nodeKeyframeTimes(clip: SceneAnimation, node: number): readonly number[] {
  return keyframeTimes({ ...clip, channels: clip.channels.filter((channel) => channel.node === node) }).times;
}

function animationBody(model: InspectorModel, node: number, host: ObjectTabHost): HTMLElement[] {
  const clip = model.clip;
  if (!clip) return [el('p', { className: 'hint', text: 'This model has no animations.' })];
  const times = nodeKeyframeTimes(clip, node);
  const clipName = clip.name || 'the shown clip';
  const parts: HTMLElement[] = [];
  if (times.length === 0) {
    parts.push(el('p', { className: 'hint', text: `No keyframes move this node in ${clipName}.` }));
  } else {
    parts.push(el('p', { className: 'hint', text: `Keyframes in ${clipName}; choose one to go to its time.` }));
    const buttons = times.slice(0, MAX_KEYFRAME_BUTTONS).map((time) => {
      const label = `Go to ${time.toFixed(2)} s`;
      const button = el(
        'button',
        { className: 'small', attributes: { type: 'button', 'aria-label': label, 'data-focus': `key:${time}` } },
        [icon('keyframe', { size: 14 }), el('span', { text: `${time.toFixed(2)} s` })],
      );
      button.title = label;
      button.addEventListener('click', () => host.seek(time));
      return button;
    });
    parts.push(el('div', { className: 'button-row' }, buttons));
    if (times.length > MAX_KEYFRAME_BUTTONS) {
      parts.push(el('p', { className: 'hint', text: `${times.length - MAX_KEYFRAME_BUTTONS} more in the timeline.` }));
    }
  }
  parts.push(el('p', { className: 'hint', text: 'Keyframes come from the file; adding them is not available yet.' }));
  return parts;
}

// The Object tab: name, visibility and lock of the selected node or element, the position and rotation of its node (the
// scale as the file has it), its keyframes in the shown clip, and the player arms of a skin.
export function buildObjectTab(
  model: InspectorModel | null,
  host: ObjectTabHost,
  sections: SectionState,
): HTMLElement[] {
  if (!model) return [el('p', { className: 'hint', text: 'Open a model to edit its objects, materials and light.' })];
  const parts: HTMLElement[] = [];
  const arms = model.player
    ? section('object-arms', 'Arms', [armsControl(model.player.arms, host.setArms)], sections)
    : null;
  const target = model.selection;
  if (!target) {
    parts.push(el('p', { className: 'hint', text: 'Select a node or element in the outliner or the 3D view.' }));
    if (arms) parts.push(arms);
    return parts;
  }
  const { doc } = model;
  const { kind, index } = target;
  const node = kind === 'node' ? index : (doc.meshes[index]?.node ?? -1);
  const locked = kind === 'node' ? isNodeLocked(doc, model, index) : isMeshLocked(doc, model, index);

  const name = el('input', {
    attributes: { type: 'text', maxlength: String(MAX_NAME_LENGTH), 'aria-label': 'Name', 'data-focus': 'name' },
  });
  name.value = displayName(doc, model.names, kind, index);
  name.addEventListener('change', () => {
    const typed = name.value.trim().slice(0, MAX_NAME_LENGTH);
    const original = (kind === 'node' ? doc.nodes[index]?.name : doc.meshes[index]?.name) ?? '';
    host.rename(kind, index, typed === original ? '' : typed);
  });
  const visible = (kind === 'node' ? model.nodeVisible : model.meshVisible)[index] === true;
  const lockedFlag = (kind === 'node' ? model.lockedNodes : model.lockedMeshes)[index] === true;
  parts.push(
    el('div', { className: 'field' }, [el('span', { text: 'Name' }), name]),
    section(
      'object-state',
      'State',
      [
        toggle('Visible', visible, 'visible', (value) => host.setVisible(kind, index, value)),
        toggle('Locked', lockedFlag, 'locked', (value) => host.setLocked(kind, index, value)),
      ],
      sections,
    ),
  );

  const transform = node >= 0 ? nodeTransform(doc, model.edits, node) : null;
  if (!transform) {
    parts.push(
      section(
        'object-transform',
        'Transform',
        [el('p', { className: 'hint', text: 'This element is not inside a group, so it has no transform.' })],
        sections,
      ),
    );
  } else {
    let translation = transform.translation;
    let rotation = transform.rotation;
    const position = xyzField({
      label: 'Position',
      unit: 'px',
      values: translation,
      step: 0.1,
      disabled: locked,
      commit: (values) => {
        translation = values;
        host.setTransform(node, translation, rotation);
      },
    });
    const turn = xyzField({
      label: 'Rotation',
      unit: '°',
      values: rotation,
      step: 1,
      disabled: locked,
      commit: (values) => {
        rotation = values;
        host.setTransform(node, translation, rotation);
      },
    });
    const scale = xyzField({ label: 'Scale', values: doc.nodes[node]?.scale ?? [1, 1, 1], step: 0.1, readOnly: true });
    const body = [
      position.element,
      turn.element,
      scale.element,
      el('p', { className: 'hint', text: 'Scale is from the file.' }),
    ];
    if (locked) body.push(el('p', { className: 'hint', text: 'Locked: unlock it to change the transform.' }));
    parts.push(section('object-transform', 'Transform', body, sections));
  }
  if (node >= 0) parts.push(section('object-animation', 'Animation', animationBody(model, node, host), sections));
  if (arms) parts.push(arms);
  return parts;
}
