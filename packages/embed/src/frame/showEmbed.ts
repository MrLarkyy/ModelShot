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

/** What the frame page runs: `update` shows the parameters of a new fragment, `stop` releases everything. */
export interface EmbedHandle {
  update(hash: string): void;
  stop(): void;
}

const USER_INPUT = ['pointerdown', 'wheel', 'keydown'] as const;

/** Thrown inside a load that was superseded: nothing more of it is shown or reported. */
class Superseded extends Error {}

interface Wanted {
  readonly params: EmbedParams;
  readonly look: LookPreset;
  readonly lookKey: string;
}

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
 * model first). Every failure is shown as `<code>: <message>` in the alert and posted to the parent. `update` with a
 * new fragment keeps the viewer (one WebGL context) and, for the same model, the loaded document: only look, camera,
 * background and autorotate change. A new model is downloaded and set into the same viewer.
 */
export function showEmbed(page: EmbedPage, hash: string, env: EmbedEnvironment): EmbedHandle {
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let download = new AbortController();
  let generation = 0;
  let viewer: Viewer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  // The key (model and arms) of the document in the viewer and of the download in flight.
  let loadedKey: string | null = null;
  let pendingKey: string | null = null;
  let wanted: Wanted | null = null;
  let appliedLookKey: string | null = null;
  let appliedViewKey: string | null = null;
  let touched = false;
  let settled = false;
  let stopRotation: (() => void) | null = null;

  // `data-light` on the stage tells a test (and a stylesheet) where the bake is: baking, lit or unbaked.
  const startBaking = (): void => {
    settled = false;
    page.stage.dataset['light'] = 'baking';
  };

  const syncRotation = (): void => {
    if (disposed || !viewer || !canvas) return;
    if (!wanted?.params.autorotate) {
      stopRotation?.();
      stopRotation = null;
    } else if (!stopRotation && !touched && settled && loadedKey !== null && pendingKey === null) {
      stopRotation = startAutorotate(viewer, { input: canvas });
    }
  };

  const showFailure = (error: unknown): void => {
    const { code, message } = describe(error);
    page.stage.dataset['state'] = 'failed';
    page.status.textContent = '';
    page.alert.textContent = `${code}: ${message}`;
    page.alert.hidden = false;
    postStatus(env.parent, env.self, { type: 'error', code, message });
  };

  const ensureViewer = (params: EmbedParams): Viewer => {
    if (viewer) return viewer;
    const created = document.createElement('canvas');
    created.setAttribute('aria-label', '3D view of the model; drag to turn it, scroll to zoom');
    page.stage.append(created);
    let made: Viewer;
    try {
      made = Viewer.create(created, {
        view: { yawDeg: params.yawDeg, pitchDeg: params.pitchDeg, fovYDeg: params.fovDeg },
        onStatus: (message) => {
          if (!disposed) page.status.textContent = message;
        },
        onBakeSettled: (lit) => {
          if (disposed) return;
          page.stage.dataset['light'] = lit ? 'lit' : 'unbaked';
          settled = true;
          syncRotation();
        },
        onResize: () => undefined,
        onChange: () => undefined,
      });
    } catch (error) {
      created.remove();
      throw error;
    }
    viewer = made;
    canvas = created;
    cleanups.push(
      () => created.remove(),
      () => made.dispose(),
    );
    for (const type of USER_INPUT) {
      created.addEventListener(
        type,
        () => {
          touched = true;
        },
        { capture: true, once: true },
      );
    }
    return made;
  };

  const applyLook = (): void => {
    if (!viewer || !wanted || appliedLookKey === wanted.lookKey) return;
    appliedLookKey = wanted.lookKey;
    startBaking();
    viewer.setLook(wanted.look);
  };

  // The starting view, without easing: the first frame shows the asked camera, and Home returns to it.
  const applyView = (force: boolean): void => {
    if (!viewer || !wanted) return;
    const { yawDeg, pitchDeg, fovDeg } = wanted.params;
    const key = `${yawDeg} ${pitchDeg} ${fovDeg}`;
    if (!force && key === appliedViewKey) return;
    appliedViewKey = key;
    viewer.setView({ yawDeg, pitchDeg, fovYDeg: fovDeg });
    viewer.orbit.setState({ fovYDeg: fovDeg });
    viewer.resetView();
  };

  const load = async (params: EmbedParams, key: string, mine: number, signal: AbortSignal): Promise<void> => {
    const live = (): void => {
      if (disposed || mine !== generation) throw new Superseded();
    };
    const current = ensureViewer(params);
    applyLook();
    const file = await fetchModel(params.model, { fetch: env.fetch, frameOrigin: env.origin, signal });
    live();
    const violation = checkIntake([file]);
    if (violation) throw violation;
    const loaded = await loadModel(groupFiles([file]), { arms: params.arms });
    live();
    const result = await current.setDocument(loaded.doc, true);
    if (result.applied) {
      // The bake of this document starts inside setDocument and settles later; an older one may have settled before.
      startBaking();
      loadedKey = key;
    }
    live();
    if (!result.applied) throw new EmbedError('SCENE_REJECTED', 'The renderer did not take the model.');
    pendingKey = null;
    applyLook();
    applyView(true);
    current.changed();
    page.stage.dataset['state'] = 'shown';
    postStatus(env.parent, env.self, { type: 'load' });
    syncRotation();
  };

  const update = (nextHash: string): void => {
    if (disposed) return;
    page.alert.hidden = true;
    page.alert.textContent = '';
    let params: EmbedParams;
    let look: LookPreset;
    let key: string;
    try {
      const parsed = parseEmbedFragment(nextHash);
      params = parsed.params;
      if (parsed.ignored.length > 0) {
        console.warn(`modelshot-embed: ignored unknown parameters ${parsed.ignored.join(', ')}`);
      }
      look = lookOf(params);
      // The intake's name checks before the download: a URL without a model extension fails without a request.
      const name = modelFileName(params.model);
      const early = checkIntake([new File([], name)]);
      if (early) throw early;
      groupFiles([new File([], name)]);
      key = `${params.model}\n${params.arms}`;
    } catch (error) {
      generation++;
      download.abort();
      pendingKey = null;
      showFailure(error);
      return;
    }
    wanted = { params, look, lookKey: `${params.look} ${params.background}` };
    if (key === pendingKey) {
      // The same model is on its way; it takes the latest parameters when it arrives.
      page.stage.dataset['state'] = 'loading';
      return;
    }
    if (key === loadedKey) {
      applyLook();
      applyView(false);
      viewer?.changed();
      page.stage.dataset['state'] = 'shown';
      syncRotation();
      return;
    }
    download.abort();
    download = new AbortController();
    const mine = ++generation;
    pendingKey = key;
    page.stage.dataset['state'] = 'loading';
    page.status.textContent = 'Loading the model…';
    load(params, key, mine, download.signal).catch((error: unknown) => {
      if (disposed || error instanceof Superseded || mine !== generation) return;
      pendingKey = null;
      showFailure(error);
    });
  };

  update(hash);

  return {
    update,
    stop: () => {
      if (disposed) return;
      disposed = true;
      download.abort();
      stopRotation?.();
      for (const cleanup of cleanups.reverse()) cleanup();
    },
  };
}
