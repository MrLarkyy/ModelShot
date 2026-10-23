import type { PathTracer } from '@modelshot/pathtracer';
import type { SceneCamera, SceneDocument } from '@modelshot/scene';
import { loadExport } from '../lazyPathTracer';
import { RENDER_SEED, MAX_SUPERSAMPLE_CHOICE } from '../render/RenderSettings';
import { el, labelled, uniqueId } from '../ui/dom';
import { downloadBlob } from './downloadBlob';
import {
  CLIP_FORMAT_CHOICES,
  DEFAULT_EXPORT_SETTINGS,
  type ClipFormatChoice,
  type ExportKind,
  type ExportSettings,
} from './ExportSettings';

export interface ExportDialogHost {
  readonly document: () => SceneDocument | null;
  readonly modelName: () => string;
  readonly camera: () => SceneCamera;
  readonly viewportAspect: () => number;
  /** The shared tracer, with scene, size and look left to the export. */
  readonly tracer: () => Promise<PathTracer>;
  readonly settings: () => ExportSettings | null;
  readonly onSettings: (settings: ExportSettings) => void;
  readonly begin: () => boolean;
  readonly end: () => void;
}

const FORMAT_LABELS: Readonly<Record<ClipFormatChoice, string>> = {
  apng: 'APNG',
  gif: 'GIF',
  webp: 'Animated WebP',
  webm: 'WebM video',
  mp4: 'MP4 video',
};
const VIDEO: readonly ClipFormatChoice[] = ['webm', 'mp4'];
const KIND_LABELS: Readonly<Record<ExportKind, string>> = {
  still: 'Still image (PNG)',
  turntable: 'Turntable clip',
  animation: 'Animation clip',
};

// The export form in a native modal dialog. The export code loads when it opens; every value is checked by the
// library's own `checkExportOptions` before the Export button works, and the file is built and saved in this page.
export class ExportDialog {
  private abort: AbortController | null = null;
  private running = false;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly host: ExportDialogHost,
  ) {
    dialog.addEventListener('close', () => this.abort?.abort());
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  async open(): Promise<void> {
    const doc = this.host.document();
    if (!doc || this.dialog.open) return;
    const lib = await loadExport();
    const stored = this.host.settings();
    const aspect = this.host.viewportAspect();
    const settings: ExportSettings = stored
      ? { ...stored }
      : { ...DEFAULT_EXPORT_SETTINGS, height: Math.max(1, Math.round(DEFAULT_EXPORT_SETTINGS.width / aspect)) };
    this.build(doc, settings, lib);
    this.dialog.showModal();
  }

  private build(doc: SceneDocument, settings: ExportSettings, lib: typeof import('@modelshot/export')): void {
    const animations = doc.animations ?? [];
    const number = (value: number, min: number, max: number): HTMLInputElement =>
      el('input', {
        attributes: { type: 'number', min: String(min), max: String(max), step: '1', value: String(value) },
      });
    const select = <T extends string>(
      values: readonly T[],
      labels: Readonly<Record<T, string>>,
      value: T,
    ): HTMLSelectElement => {
      const s = el(
        'select',
        {},
        values.map((v) => el('option', { text: labels[v], attributes: { value: v } })),
      );
      s.value = value;
      return s;
    };
    const kinds: ExportKind[] = animations.length > 0 ? ['still', 'turntable', 'animation'] : ['still', 'turntable'];
    const kind = select(kinds, KIND_LABELS, kinds.includes(settings.kind) ? settings.kind : 'still');
    const format = select(CLIP_FORMAT_CHOICES, FORMAT_LABELS, settings.clipFormat);
    const animation = el(
      'select',
      {},
      animations.map((a, i) =>
        el('option', { text: a.name || `Animation ${i + 1}`, attributes: { value: String(i) } }),
      ),
    );
    const width = number(settings.width, 1, lib.MAX_EXPORT_SIDE);
    const height = number(settings.height, 1, lib.MAX_EXPORT_SIDE);
    const samples = number(settings.samples, 1, 65536);
    const supersample = select(
      Array.from({ length: MAX_SUPERSAMPLE_CHOICE }, (_, i) => String(i + 1)),
      Object.fromEntries(Array.from({ length: MAX_SUPERSAMPLE_CHOICE }, (_, i) => [String(i + 1), `${i + 1}×`])),
      String(settings.supersample),
    );
    const fps = number(settings.fps, 1, lib.MAX_CLIP_FPS);
    const frames = number(settings.frames, 2, lib.MAX_CLIP_FRAMES);
    const denoise = el('input', { attributes: { type: 'checkbox' } });
    denoise.checked = settings.denoise;
    const transparent = el('input', { attributes: { type: 'checkbox' } });
    transparent.checked = settings.transparent;

    const kindField = labelled('Kind', kind);
    const formatField = labelled('Format', format);
    const animationField = labelled('Animation', animation);
    const fpsField = labelled('Frames per second', fps);
    const framesField = labelled('Frames', frames);
    const transparentField = el('label', { className: 'choice' }, [
      transparent,
      el('span', { text: 'Transparent background' }),
    ]);

    const problem = el('p', { className: 'field-error', attributes: { 'aria-live': 'polite' } });
    const progress = el('progress', {
      attributes: { max: '1', value: '0', 'aria-label': 'Export progress', hidden: '' },
    });
    const note = el('p', { className: 'hint', attributes: { 'aria-live': 'polite' } });
    const failure = el('p', { className: 'error', attributes: { role: 'alert', hidden: '' } });
    const exportButton = el('button', { text: 'Export', attributes: { type: 'button' } });
    const closeButton = el('button', { text: 'Close', attributes: { type: 'button' } });
    const cancelButton = el('button', { text: 'Cancel export', attributes: { type: 'button', hidden: '' } });
    const heading = el('h2', { id: 'export-title', text: 'Export' });

    const read = (): ExportSettings => ({
      kind: kind.value as ExportKind,
      clipFormat: format.value as ClipFormatChoice,
      width: Number(width.value),
      height: Number(height.value),
      samples: Number(samples.value),
      supersample: Number(supersample.value),
      denoise: denoise.checked,
      transparent: transparent.checked,
      fps: Number(fps.value),
      frames: Number(frames.value),
    });

    const options = (s: ExportSettings): unknown => {
      const common = {
        width: s.width,
        height: s.height,
        camera: this.host.camera(),
        samples: s.samples,
        seed: RENDER_SEED,
        supersample: s.supersample,
        denoise: s.denoise,
        transparent: s.transparent && (s.kind === 'still' || !VIDEO.includes(s.clipFormat)),
      };
      if (s.kind === 'still') return { kind: 'still', ...common };
      const clip = { ...common, format: s.clipFormat, fps: s.fps };
      return s.kind === 'turntable'
        ? { kind: 'turntable', ...clip, frames: s.frames }
        : { kind: 'animation', ...clip, animation: Number(animation.value) || 0 };
    };

    const validate = (): void => {
      const s = read();
      const clip = s.kind !== 'still';
      formatField.hidden = !clip;
      animationField.hidden = s.kind !== 'animation';
      fpsField.hidden = !clip;
      framesField.hidden = s.kind !== 'turntable';
      const video = clip && VIDEO.includes(s.clipFormat);
      transparent.disabled = video;
      transparentField.title = video ? 'Video formats have no transparency.' : '';
      try {
        lib.checkExportOptions(doc, options(s));
        problem.textContent = '';
        exportButton.disabled = this.running;
      } catch (error) {
        problem.textContent =
          error instanceof lib.ExportError && error.field
            ? `${error.field}: ${error.message}`
            : String(error instanceof Error ? error.message : error);
        exportButton.disabled = true;
      }
      this.host.onSettings(s);
    };

    const setRunning = (running: boolean): void => {
      this.running = running;
      progress.hidden = !running;
      cancelButton.hidden = !running;
      for (const control of this.dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
        control.disabled = running;
      }
      closeButton.disabled = false;
      if (!running) validate();
      else exportButton.disabled = true;
    };

    const run = async (): Promise<void> => {
      if (this.running || !this.host.begin()) return;
      failure.hidden = true;
      note.textContent = '';
      const controller = new AbortController();
      this.abort = controller;
      setRunning(true);
      try {
        const s = read();
        const tracer = await this.host.tracer();
        const onProgress = (p: { fraction: number; phase: string }): void => {
          progress.value = p.fraction;
          note.textContent = `${p.phase === 'render' ? 'Rendering' : 'Encoding'} ${Math.round(p.fraction * 100)} %`;
        };
        const checked = options(s);
        const result =
          s.kind === 'still'
            ? await lib.exportStill(tracer, doc, checked as Parameters<typeof lib.exportStill>[2], {
                signal: controller.signal,
                onProgress,
              })
            : await lib.exportClip(tracer, doc, checked as Parameters<typeof lib.exportClip>[2], {
                signal: controller.signal,
                onProgress,
              });
        const file = downloadBlob(result.blob, this.host.modelName(), result.extension);
        const warnings = result.warnings.map((w) => w.message).join(' ');
        note.textContent =
          `Saved ${file} (${result.width} × ${result.height}, ${result.frames} frame${result.frames === 1 ? '' : 's'}). ${warnings}`.trim();
      } catch (error) {
        if (error instanceof lib.ExportError && error.code === 'CANCELLED') {
          note.textContent = 'Export cancelled.';
        } else {
          failure.hidden = false;
          failure.textContent = error instanceof Error ? error.message : String(error);
        }
      } finally {
        this.abort = null;
        this.host.end();
        setRunning(false);
      }
    };

    exportButton.addEventListener('click', () => void run());
    cancelButton.addEventListener('click', () => this.abort?.abort());
    closeButton.addEventListener('click', () => this.close());
    for (const control of [
      kind,
      format,
      animation,
      width,
      height,
      samples,
      supersample,
      fps,
      frames,
      denoise,
      transparent,
    ]) {
      control.addEventListener('input', validate);
      control.addEventListener('change', validate);
    }

    const idForm = uniqueId('export-form');
    this.dialog.replaceChildren(
      heading,
      el('form', { id: idForm, attributes: { method: 'dialog', novalidate: '' } }, [
        kindField,
        formatField,
        animationField,
        labelled('Width (px)', width),
        labelled('Height (px)', height),
        labelled('Samples', samples),
        labelled('Supersampling', supersample),
        fpsField,
        framesField,
        el('label', { className: 'choice' }, [denoise, el('span', { text: 'Denoise' })]),
        transparentField,
        problem,
        progress,
        note,
        failure,
        el('div', { className: 'button-row' }, [exportButton, cancelButton, closeButton]),
      ]),
    );
    this.dialog.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault());
    validate();
  }
}
