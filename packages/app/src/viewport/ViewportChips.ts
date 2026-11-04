import type { LayoutStore } from '../layout/LayoutStore';
import { OVERLAY_IDS, type OverlayId } from '../layout/layoutState';
import { CAMERA_PRESETS, type CameraPresetId } from '../panels/cameraPresets';
import { bindDisclosure } from '../ui/bindDisclosure';
import { el } from '../ui/dom';

const OVERLAY_LABELS: Readonly<Record<OverlayId, string>> = {
  grid: 'Grid floor',
  axis: 'Axis gizmo',
  stats: 'Statistics',
  presets: 'Camera presets',
  gizmos: 'Light and transform gizmos',
};

// The buttons over the viewport: camera presets, and the menu that switches each overlay on or off. The overlay choices
// live in the layout store.
export class ViewportChips {
  private readonly boxes = new Map<OverlayId, HTMLInputElement>();

  constructor(
    private readonly presets: HTMLElement,
    menuButton: HTMLButtonElement,
    menu: HTMLElement,
    private readonly store: LayoutStore,
    apply: (id: CameraPresetId) => void,
  ) {
    presets.replaceChildren(
      ...CAMERA_PRESETS.map((preset) => {
        const button = el('button', {
          text: preset.label,
          attributes: { type: 'button', 'aria-label': `${preset.label} view` },
        });
        button.addEventListener('click', () => apply(preset.id));
        return button;
      }),
    );
    const rows = OVERLAY_IDS.map((id) => {
      const box = el('input', { attributes: { type: 'checkbox' } });
      box.addEventListener('change', () =>
        this.store.update({ overlays: { ...this.store.state.overlays, [id]: box.checked } }),
      );
      this.boxes.set(id, box);
      return el('label', { className: 'choice' }, [box, el('span', { text: OVERLAY_LABELS[id] })]);
    });
    menu.replaceChildren(...rows);
    bindDisclosure(menuButton, menu);
    store.onChange(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const { overlays } = this.store.state;
    for (const [id, box] of this.boxes) box.checked = overlays[id];
    this.presets.hidden = !overlays.presets;
  }
}
