import { MAX_FOV_DEG, MIN_FOV_DEG, type OrbitController } from '@modelshot/renderer-rt';
import { el, uniqueId } from '../ui/dom';
import { section } from '../ui/section';
import type { SectionState } from '../ui/sectionState';
import { activeCameraPreset, applyCameraPreset, CAMERA_PRESETS, type CameraPresetId } from './cameraPresets';

export interface CameraPanelHost {
  readonly orbit: OrbitController;
  /** The orbit controller was changed from here: redraw and remember. */
  readonly changed: () => void;
  readonly frameModel: () => void;
  readonly resetView: () => void;
  /** The preset the camera stands at changed (null: none): the chips over the view follow. */
  readonly presetMarked?: (preset: CameraPresetId | null) => void;
}

// The Camera section of the Render tab: preset, field of view, projection, frame and reset. The preset angles are applied
// with `applyPreset` (viewport chips, keys). `sync` shows what the controller holds, whoever changed it (the viewport's
// mouse and keys included, so O and I stay in step), and marks the matching preset here and on the chips in one place.
export class CameraPanel {
  private readonly fov: HTMLInputElement;
  private readonly fovValue: HTMLSpanElement;
  private readonly perspective: HTMLInputElement;
  private readonly orthographic: HTMLInputElement;
  private readonly presets = new Map<CameraPresetId, HTMLButtonElement>();

  constructor(
    root: HTMLElement,
    private readonly host: CameraPanelHost,
    sections: SectionState,
  ) {
    const fovId = uniqueId('fov');
    this.fov = el('input', {
      id: fovId,
      attributes: { type: 'range', min: String(MIN_FOV_DEG), max: String(MAX_FOV_DEG), step: '1', 'data-focus': 'fov' },
    });
    // A plain span: an <output> element is a live region (role status) and the page has exactly one status line.
    this.fovValue = el('span', { className: 'slider-value', attributes: { 'aria-hidden': 'true' } });
    this.fov.addEventListener('input', () => {
      host.orbit.setFov(Number(this.fov.value));
      this.sync();
      host.changed();
    });

    const group = uniqueId('projection');
    const radio = (value: 'perspective' | 'orthographic', label: string): [HTMLInputElement, HTMLLabelElement] => {
      const input = el('input', {
        attributes: { type: 'radio', name: group, value, 'data-focus': `projection:${value}` },
      });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        host.orbit.setProjection(value);
        this.sync();
        host.changed();
      });
      return [input, el('label', { className: 'segment' }, [input, el('span', { text: label })])];
    };
    const [perspective, perspectiveLabel] = radio('perspective', 'Perspective');
    const [orthographic, orthographicLabel] = radio('orthographic', 'Orthographic');
    this.perspective = perspective;
    this.orthographic = orthographic;

    const button = (text: string, label: string, run: () => void): HTMLButtonElement => {
      const b = el('button', { text, attributes: { type: 'button', 'aria-label': label } });
      b.addEventListener('click', () => {
        run();
        this.sync();
      });
      return b;
    };
    const presetButtons = CAMERA_PRESETS.map((preset) => {
      const b = el('button', {
        className: 'small',
        text: preset.label,
        attributes: {
          type: 'button',
          'aria-pressed': 'false',
          'aria-label': `${preset.label} camera`,
          'data-focus': `preset:${preset.id}`,
        },
      });
      b.addEventListener('click', () => this.applyPreset(preset.id));
      this.presets.set(preset.id, b);
      return b;
    });

    root.replaceChildren(
      section(
        'render-camera',
        'Camera',
        [
          el(
            'div',
            { className: 'button-row', attributes: { role: 'group', 'aria-label': 'Camera presets' } },
            presetButtons,
          ),
          el('div', { className: 'field' }, [
            el('label', { text: 'Field of view', attributes: { for: fovId } }),
            this.fov,
            this.fovValue,
          ]),
          el('fieldset', { className: 'segmented', attributes: { 'aria-label': 'Projection' } }, [
            perspectiveLabel,
            orthographicLabel,
          ]),
          el('div', { className: 'button-row' }, [
            button('Frame', 'Frame the model', () => host.frameModel()),
            button('Reset', 'Reset the view', () => host.resetView()),
          ]),
        ],
        sections,
      ),
    );
    this.sync();
  }

  applyPreset(id: CameraPresetId): void {
    applyCameraPreset(this.host.orbit, id);
    this.sync();
    this.host.changed();
  }

  /** Shows the controller's field of view, projection and preset. */
  sync(): void {
    const { orbit } = this.host;
    this.fov.value = String(Math.round(orbit.fov));
    this.fovValue.textContent = `${Math.round(orbit.fov)}°`;
    this.fov.setAttribute('aria-valuetext', `${Math.round(orbit.fov)} degrees`);
    const ortho = orbit.projection === 'orthographic';
    this.fov.disabled = ortho;
    this.perspective.checked = !ortho;
    this.orthographic.checked = ortho;
    const active = activeCameraPreset(orbit);
    for (const [id, b] of this.presets) b.setAttribute('aria-pressed', String(id === active));
    this.host.presetMarked?.(active);
  }
}
