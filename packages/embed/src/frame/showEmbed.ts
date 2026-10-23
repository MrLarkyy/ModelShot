import { checkIntake, groupFiles, loadModel } from '@modelshot/app/intake';
import { Viewer } from '@modelshot/app/viewer';
import { LOOK_PRESETS, checkLookPreset, type LookPreset } from '@modelshot/looks';
import { EmbedError } from '../EmbedError';
import type { EmbedParams } from '../EmbedParams';
import { parseEmbedFragment } from '../parseEmbedFragment';
import { startAutorotate } from './autorotate';
import { backdropForDisplay } from './backdropForDisplay';
import { fetchModel } from './fetchModel';
import { hexDisplayColor } from './hexDisplayColor';
import { modelFileName } from './modelFileName';
import { postStatus, type StatusTarget } from './postStatus';

/** The frame page's elements: the stage the canvas goes into, a status line and an alert. */
export interface EmbedPage {
  readonly stage: HTMLElement;
  readonly status: HTMLElement;
  readonly alert: HTMLElement;
}

export interface EmbedEnvironment {
  readonly fetch: typeof fetch;
  /** The frame page's origin. */
  readonly origin: string;
  readonly parent: StatusTarget;
  readonly self: StatusTarget;
}

/**
 * The viewer's status once its first light bake settled, lit or not (`Viewer` of the app). Autorotate waits for it:
 * redrawing every frame while the bake runs would slow the bake, a CPU renderer's most of all.
 */
const BAKE_SETTLED = /^(?:Preview lit\.|The preview shows unbaked light)/;
const USER_INPUT = ['pointerdown', 'wheel', 'keydown'] as const;

/** Thrown inside a show that was superseded: nothing more of it is shown or reported. */
class Superseded extends Error {}

function describe(error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return { code: typeof code === 'string' && code !== '' ? code : 'LOAD_FAILED', message };
}

function lookOf(params: EmbedParams): LookPreset {
  const look = LOOK_PRESETS[params.look];
  if (!look) throw new EmbedError('INVALID_PARAM', `look ${params.look} is not a preset of this embed.`, 'look');
  if (params.background === null) return look;
  // As the renderers' background option does it: a flat backdrop of that colour, checked like any look.
  const colour = backdropForDisplay(hexDisplayColor(params.background), look.toneMapping);
  return checkLookPreset({ ...look, backdrop: { top: colour, bottom: colour } });
}

/**
 * Shows the model the URL fragment `hash` describes: parameters, WebGL2 viewer, download, the app's intake checks and
 * worker loader, look and camera, then autorotate if asked (once the light is baked, unless the visitor moved the
 * model first). Every failure is shown as `<code>: <message>` in the alert
 * and posted to the parent. Returns the function that stops it and releases the viewer (a new fragment shows anew).
 */
export function showEmbed(page: EmbedPage, hash: string, env: EmbedEnvironment): () => void {
  const download = new AbortController();
  const cleanups: (() => void)[] = [];
  let disposed = false;
  const live = (): void => {
    if (disposed) throw new Superseded();
  };
  page.alert.hidden = true;
  page.alert.textContent = '';
  page.stage.dataset['state'] = 'loading';
  page.status.textContent = 'Loading the model…';

  const run = async (): Promise<void> => {
    const { params, ignored } = parseEmbedFragment(hash);
    if (ignored.length > 0) console.warn(`modelshot-embed: ignored unknown parameters ${ignored.join(', ')}`);
    const look = lookOf(params);
    // The intake's name checks before the download: a URL without a model extension fails without a request.
    const name = modelFileName(params.model);
    const early = checkIntake([new File([], name)]);
    if (early) throw early;
    groupFiles([new File([], name)]);

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '3D view of the model; drag to turn it, scroll to zoom');
    page.stage.append(canvas);
    cleanups.push(() => canvas.remove());
    let rotate = params.autorotate;
    let shown = false;
    let settled = false;
    const touched = (): void => {
      rotate = false;
    };
    for (const type of USER_INPUT) canvas.addEventListener(type, touched, { capture: true, once: true });
    const startRotating = (): void => {
      if (!rotate || !shown || !settled || disposed) return;
      rotate = false;
      cleanups.push(startAutorotate(viewer, { input: canvas }));
    };
    const viewer = Viewer.create(canvas, {
      onStatus: (message) => {
        if (disposed) return;
        page.status.textContent = message;
        if (BAKE_SETTLED.test(message)) {
          settled = true;
          startRotating();
        }
      },
      onResize: () => undefined,
      onChange: () => undefined,
    });
    cleanups.push(() => viewer.dispose());
    viewer.setLook(look);

    const file = await fetchModel(params.model, { fetch: env.fetch, frameOrigin: env.origin, signal: download.signal });
    live();
    const violation = checkIntake([file]);
    if (violation) throw violation;
    const loaded = await loadModel(groupFiles([file]), { arms: params.arms });
    live();
    const result = await viewer.setDocument(loaded.doc, true);
    live();
    if (!result.applied) throw new EmbedError('SCENE_REJECTED', 'The renderer did not take the model.');
    viewer.orbit.setState({ fovYDeg: params.fovDeg, yawDeg: params.yawDeg, pitchDeg: params.pitchDeg });
    viewer.orbit.frame();
    // No easing from the default view: the first frame shows the asked camera.
    viewer.orbit.update(1e9);
    viewer.changed();
    page.stage.dataset['state'] = 'shown';
    postStatus(env.parent, env.self, { type: 'load' });
    shown = true;
    startRotating();
  };

  run().catch((error: unknown) => {
    if (disposed || error instanceof Superseded) return;
    const { code, message } = describe(error);
    page.stage.dataset['state'] = 'failed';
    page.status.textContent = '';
    page.alert.textContent = `${code}: ${message}`;
    page.alert.hidden = false;
    postStatus(env.parent, env.self, { type: 'error', code, message });
  });

  return () => {
    if (disposed) return;
    disposed = true;
    download.abort();
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
