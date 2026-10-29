import { loadBbmodel } from '@modelshot/formats';
import { DEFAULT_LOOK, LOOK_PRESETS } from '@modelshot/looks';
import { LightBaker, PathTracer } from '@modelshot/pathtracer';
import { OrbitController, RealtimeRenderer } from '@modelshot/renderer-rt';
import { sceneBounds, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import { fitCameraToPoints } from './fitCameraToPoints';
import { lookByName } from './lookByName';
import { rtScene } from './rtScenes';
import { sceneTriangles } from './sceneTriangles';

// The look review page (MS-19): a model the user picks (read from the file input, nothing fetched) or the harness
// player, under a look preset, side by side in the baked preview and the path tracer, each downloadable as a PNG for
// a comparison with reference images outside the repository. Harness only, never part of a build. URL parameters:
// preset (default studio), samples (render samples, default 256), size (CSS pixels, default 512), yaw and pitch (the
// form's initial values, defaults 210 and 20; the form checks them). The camera fits the
// model's outline (its vertices) to the view by default, the app's bounding-sphere framing when unticked. It renders
// once on load and sets data-state="done" on the body when both images are complete.

const params = new URLSearchParams(location.search);

function intParam(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new Error(`query parameter ${name} must be an integer in ${min}..${max}`);
  }
  return Number(raw);
}

/** Largest model file read; the loader checks its own limits after this. */
const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const BAKE_SAMPLES = 64;
const SEED = 1;

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found as T;
};

const size = intParam('size', 512, 64, 2048);
const samples = intParam('samples', 256, 1, 4096);
const form = element<HTMLFormElement>('controls');
const modelInput = element<HTMLInputElement>('model');
const presetSelect = element<HTMLSelectElement>('preset');
const yawInput = element<HTMLInputElement>('yaw');
const pitchInput = element<HTMLInputElement>('pitch');
const fitInput = element<HTMLInputElement>('fit');
const button = element<HTMLButtonElement>('render');
const status = element<HTMLElement>('status');

for (const look of Object.values(LOOK_PRESETS)) presetSelect.add(new Option(look.name, look.id));
presetSelect.value = params.get('preset') ?? DEFAULT_LOOK.id;
yawInput.value = params.get('yaw') ?? yawInput.value;
pitchInput.value = params.get('pitch') ?? pitchInput.value;

const canvas = (host: string): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  element(host).appendChild(c);
  return c;
};
const previewCanvas = canvas('preview-host');
const renderCanvas = canvas('render-host');
const cssSize = { cssWidth: size, cssHeight: size, devicePixelRatio: 1 };
const preview = RealtimeRenderer.create(previewCanvas, { preserveDrawingBuffer: true });
const tracer = PathTracer.create(renderCanvas, { preserveDrawingBuffer: true });
const baker = LightBaker.create();
preview.resize(cssSize);
tracer.resize(cssSize);

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function pickedScene(): Promise<{ doc: SceneDocument; name: string }> {
  const file = modelInput.files?.[0];
  if (!file) return { doc: rtScene('player-hold'), name: 'player-hold' };
  if (file.size > MAX_MODEL_BYTES) throw new Error(`${file.name} is over ${MAX_MODEL_BYTES / 1024 / 1024} MiB`);
  return { doc: loadBbmodel(new Uint8Array(await file.arrayBuffer())).scene, name: file.name.replace(/\.[^.]*$/, '') };
}

function camera(doc: SceneDocument): SceneCamera {
  const yawDeg = Number(yawInput.value) || 0;
  const pitchDeg = Math.max(-89, Math.min(89, Number(pitchInput.value) || 0));
  const controller = new OrbitController({ damping: false, yawDeg, pitchDeg });
  controller.setAspect(1);
  const bounds = sceneBounds(doc);
  controller.reset(bounds);
  if (!fitInput.checked || !bounds) return controller.camera();
  return fitCameraToPoints(sceneTriangles(doc).positions, bounds, yawDeg, pitchDeg, controller.fov, 1);
}

async function download(link: HTMLAnchorElement, source: HTMLCanvasElement, name: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, 'image/png'));
  if (!blob) return;
  if (link.href) URL.revokeObjectURL(link.href);
  link.href = URL.createObjectURL(blob);
  link.download = name;
}

async function run(): Promise<void> {
  document.body.dataset['state'] = 'running';
  button.disabled = true;
  try {
    const look = lookByName(presetSelect.value);
    const { doc, name } = await pickedScene();
    const view = camera(doc);
    status.textContent = `Loading ${name}…`;
    preview.setLook(look);
    tracer.setLook(look);
    await preview.setScene(doc);
    preview.setCamera(view);
    preview.render();
    status.textContent = `Baking ${name} under ${look.name}…`;
    const { lighting } = await baker.bake(doc, { samples: BAKE_SAMPLES, seed: SEED, look });
    if (lighting && preview.setLighting(lighting)) {
      while (preview.advanceLighting()) await nextTask();
    }
    // The finished frame: an exact-key frame (the player) draws its samples over several calls.
    do preview.render();
    while (preview.needsRender);
    await download(element('preview-download'), previewCanvas, `${name}-${look.id}-preview.png`);
    await tracer.setScene(doc);
    tracer.setCamera(view);
    tracer.start({ seed: SEED, samples });
    while (tracer.step(4) > 0 || tracer.guiding) {
      status.textContent = `Rendering ${name} under ${look.name}: ${tracer.samplesDone} / ${samples} samples`;
      await nextTask();
    }
    await download(element('render-download'), renderCanvas, `${name}-${look.id}-s${SEED}-n${samples}.png`);
    status.textContent = `${name} under ${look.name}: preview baked with ${BAKE_SAMPLES} samples, render ${samples} samples.`;
    document.body.dataset['state'] = 'done';
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
    document.body.dataset['state'] = 'failed';
  } finally {
    button.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const bad = [yawInput, pitchInput].find((input) => !input.checkValidity());
  if (bad) {
    status.textContent = `Not rendered: ${bad.id} ${bad.validationMessage}`;
    document.body.dataset['state'] = 'failed';
    bad.focus();
    return;
  }
  void run();
});
void run();
