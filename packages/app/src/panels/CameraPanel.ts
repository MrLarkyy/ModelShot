import { MAX_FOV_DEG, MIN_FOV_DEG, type OrbitController } from '@modelshot/renderer-rt';
import { el, uniqueId } from '../ui/dom';
import { CAMERA_PRESETS, applyCameraPreset, type CameraPresetId } from './cameraPresets';

export interface CameraPanelHost {
  readonly orbit: OrbitController;
  /** The orbit controller was changed from here: redraw and remember. */
  readonly changed: () => void;
  readonly frameModel: () => void;
  readonly resetView: () => void;
}

// Field of view, projection, frame and reset, and the preset angles. `sync` shows what the controller holds, whoever
// changed it (the viewport's mouse and keys included, so O and I stay in step).
export class CameraPanel {
  private readonly fov: HTMLInputElement;
  private readonly fovValue: HTMLSpanElement;
  private readonly perspective: HTMLInputElement;
  private readonly orthographic: HTMLInputElement;

  constructor(
    root: HTMLElement,
    private readonly host: CameraPanelHost,
  ) {
    const fovId = uniqueId('fov');
    this.fov = el('input', {
      id: fovId,
      attributes: { type: 'range', min: String(MIN_FOV_DEG), max: String(MAX_FOV_DEG), step: '1' },
    });
    // A plain span: an <output> element is a live region (role status) and the page has exactly one status line.
    this.fovValue = el('span', { attributes: { 'aria-hidden': 'true' } });
    this.fov.addEventListener('input', () => {
      host.orbit.setFov(Number(this.fov.value));
      this.sync();
      host.changed();
    });

    const group = uniqueId('projection');
    const radio = (value: 'perspective' | 'orthographic', label: string): [HTMLInputElement, HTMLLabelElement] => {
      const input = el('input', { attributes: { type: 'radio', name: group, value } });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        host.orbit.setProjection(value);
        this.sync();
        host.changed();
      });
      return [input, el('label', { className: 'choice' }, [input, el('span', { text: label })])];
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

    root.replaceChildren(
      el('div', { className: 'field' }, [
        el('label', { text: 'Field of view', attributes: { for: fovId } }),
        this.fov,
        this.fovValue,
      ]),
      el('fieldset', {}, [el('legend', { text: 'Projection' }), perspectiveLabel, orthographicLabel]),
      el('div', { className: 'button-row' }, [
        button('Frame', 'Frame the model', () => host.frameModel()),
        button('Reset', 'Reset the view', () => host.resetView()),
      ]),
      el(
        'div',
        { className: 'button-row', attributes: { role: 'group', 'aria-label': 'Preset angles' } },
        CAMERA_PRESETS.map((preset) => button(preset.label, `${preset.label} view`, () => this.applyPreset(preset.id))),
      ),
    );
    this.sync();
  }

  applyPreset(id: CameraPresetId): void {
    applyCameraPreset(this.host.orbit, id);
    this.sync();
    this.host.changed();
  }

  /** Shows the controller's field of view and projection. */
  sync(): void {
    const { orbit } = this.host;
    this.fov.value = String(Math.round(orbit.fov));
    this.fovValue.textContent = `${Math.round(orbit.fov)}°`;
    this.fov.setAttribute('aria-valuetext', `${Math.round(orbit.fov)} degrees`);
    const ortho = orbit.projection === 'orthographic';
    this.fov.disabled = ortho;
    this.perspective.checked = !ortho;
    this.orthographic.checked = ortho;
  }
}
