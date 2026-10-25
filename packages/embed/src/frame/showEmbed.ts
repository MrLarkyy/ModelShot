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

/** What the frame page runs: `update` shows the parameters of a new fragment. */
export interface EmbedHandle {
  update(hash: string): void;
}

const USER_INPUT = ['pointerdown', 'wheel', 'keydown'] as const;

/** Thrown inside a load that was superseded: nothing more of it is shown or reported. */
class Superseded extends Error {}

type ViewerDocument = Parameters<Viewer['setDocument']>[0];
type ViewerSetResult = Awaited<ReturnType<Viewer['setDocument']>>;

interface Wanted {
  readonly params: EmbedParams;
  readonly look: LookPreset;
  /** The model and arms: the same key keeps the loaded document. */
  readonly key: string;
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
 * model first). Every failure is shown as `<code>: <message>` in the alert and posted to the parent, and stops
 * autorotate; `load` is posted whenever a model is shown after loading or an error, never for a look or camera change.
 * `update` with a new fragment keeps the viewer (one WebGL context) and, for the same model, the loaded document: only
 * look, camera, background and autorotate change. A new model is downloaded and set into the same viewer. The latest
 * fragment wins: a download or read it no longer asks for is aborted, and a model set while a newer fragment arrived is
 * replaced by the one that fragment asks for. The frame document is the lifetime of all of it.
 */
export function showEmbed(page: EmbedPage, hash: string, env: EmbedEnvironment): EmbedHandle {
  let download = new AbortController();
  // Bumped whenever the model on its way changes or a fragment fails: a load of an older generation shows and reports
  // nothing.
  let generation = 0;
  let viewer: Viewer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  // The key (model and arms) of the document in the viewer, and of the load of the current generation.
  let shownKey: string | null = null;
  let pendingKey: string | null = null;
  // The latest valid fragment; null after an invalid one.
  let wanted: Wanted | null = null;
  let appliedLookKey: string | null = null;
  let appliedViewKey: string | null = null;
  let touched = false;
  let settled = false;
  let stopRotation: (() => void) | null = null;
  // setDocument calls run one after another, so the document set last is the one of the latest load that got there.
  let documents: Promise<void> = Promise.resolve();

  const stopRotating = (): void => {
    stopRotation?.();
    stopRotation = null;
  };

  // Turns while the wanted model is the one shown and autorotate is asked; starts once its light settled, unless the
  // visitor moved it.
  const syncRotation = (): void => {
    if (!viewer || !canvas) return;
    const showing = wanted !== null && pendingKey === null && shownKey === wanted.key;
    if (!showing || !wanted?.params.autorotate) {
      stopRotating();
    } else if (!stopRotation && !touched && settled) {
      stopRotation = startAutorotate(viewer, { input: canvas });
    }
  };

  const showFailure = (error: unknown): void => {
    const { code, message } = describe(error);
    // Nothing redraws behind the alert.
    stopRotating();
    page.stage.dataset['state'] = 'failed';
    page.status.textContent = '';
    page.alert.textContent = `${code}: ${message}`;
    page.alert.hidden = false;
    postStatus(env.parent, env.self, { type: 'error', code, message });
  };

  // `load` tells the host a model is shown: after loading or an error, not again for a look or camera change.
  const showModel = (): void => {
    const before = page.stage.dataset['state'];
    page.stage.dataset['state'] = 'shown';
    if (before !== 'shown') postStatus(env.parent, env.self, { type: 'load' });
    syncRotation();
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
          page.status.textContent = message;
        },
        // `data-light` on the stage tells a test (and a stylesheet) where the bake is: baking, lit or unbaked.
        onBakeStarted: () => {
          settled = false;
          page.stage.dataset['light'] = 'baking';
        },
        onBakeSettled: (lit) => {
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

  const cancelLoad = (): void => {
    generation++;
    download.abort();
    pendingKey = null;
  };

  // Sets the document of the load of generation `mine` after any earlier call, unless a newer generation came first
  // (null). A document set while a newer generation came is in the viewer all the same: `reconcile` replaces it.
  const setDocument = (
    target: Viewer,
    doc: ViewerDocument,
    key: string,
    mine: number,
  ): Promise<ViewerSetResult | null> => {
    const run = documents.then(async () => {
      if (mine !== generation) return null;
      const result = await target.setDocument(doc, true);
      if (result.applied) {
        shownKey = key;
        if (mine !== generation) reconcile();
      }
      return result;
    });
    documents = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const load = async (params: EmbedParams, key: string, mine: number, signal: AbortSignal): Promise<void> => {
    const live = (): void => {
      if (mine !== generation) throw new Superseded();
    };
    const current = ensureViewer(params);
    applyLook();
    const file = await fetchModel(params.model, { fetch: env.fetch, frameOrigin: env.origin, signal });
    live();
    const violation = checkIntake([file]);
    if (violation) throw violation;
    const loaded = await loadModel(groupFiles([file]), { arms: params.arms, signal });
    live();
    const result = await setDocument(current, loaded.doc, key, mine);
    live();
    if (!result?.applied) throw new EmbedError('SCENE_REJECTED', 'The renderer did not take the model.');
    pendingKey = null;
    applyLook();
    applyView(true);
    current.changed();
    showModel();
  };

  const startLoad = (params: EmbedParams, key: string): void => {
    download.abort();
    download = new AbortController();
    const mine = ++generation;
    pendingKey = key;
    page.stage.dataset['state'] = 'loading';
    page.status.textContent = 'Loading the model…';
    syncRotation();
    load(params, key, mine, download.signal).catch((error: unknown) => {
      if (error instanceof Superseded || mine !== generation) return;
      pendingKey = null;
      showFailure(error);
    });
  };

  // Brings the viewer to the latest valid fragment: the model in the viewer is shown with its parameters (any load
  // aborted), the load of its model goes on, or its model is loaded.
  function reconcile(): void {
    if (!wanted) return;
    const { params, key } = wanted;
    if (key === shownKey) {
      if (pendingKey !== null) {
        cancelLoad();
        page.status.textContent = '';
      }
      applyLook();
      applyView(false);
      viewer?.changed();
      showModel();
      return;
    }
    if (key === pendingKey) {
      // The model is on its way; it takes the latest parameters when it arrives.
      page.stage.dataset['state'] = 'loading';
      return;
    }
    startLoad(params, key);
  }

  const update = (nextHash: string): void => {
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
      wanted = null;
      cancelLoad();
      showFailure(error);
      return;
    }
    wanted = { params, look, key, lookKey: `${params.look} ${params.background}` };
    reconcile();
  };

  update(hash);

  return { update };
}
