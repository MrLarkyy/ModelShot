import {
  DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
  RendererError,
  decodeTextures,
  lightmapLayout,
  shadowCatcherPlane,
  validateScene,
  type BakedLighting,
  type DecodedTextures,
} from '@modelshot/renderer-rt';
import { sceneBounds, type SceneDocument } from '@modelshot/scene';
import { LIGHT_RIG_V0 } from '@modelshot/looks';
import { buildBvh } from '../buildBvh';
import { flattenScene } from '../flattenScene';
import { layoutTextures } from '../layoutTextures';
import { checkMaterialCount, packGeometry, packMaterials } from '../packSceneData';
import { PathTracerError } from '../PathTracerError';
import type { PathTracerWarning } from '../PathTracerWarning';
import { sampleTiles } from '../sampleSchedule';
import { progressSamples, type BakeReply, type BakeRequest } from './bakeMessages';
import { BakeSession, type BakeLimits, type BakePass, type BakeScene } from './BakeSession';
import { buildChartTable } from './chartTable';
import { toHalf } from './halfFloat';

interface WorkerScope {
  postMessage(message: BakeReply, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<BakeRequest>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const MAX_TEXTURE_SIDE = 4096;
/** Fence polls before a blocking one-texel read makes sure the GPU finished (a driver that never signals). */
const MAX_FENCE_POLLS = 1000;

interface Job {
  readonly id: number;
  readonly seed: number;
  readonly samples: number;
  readonly tileSize: number;
  readonly countCapped: boolean;
  stopped: boolean;
  scene: BakeScene | null;
  layoutKey: string;
  warnings: readonly PathTracerWarning[];
}

const canvas = new OffscreenCanvas(1, 1);
const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'high-performance',
});
let session: BakeSession | null = null;
let sessionError: unknown = null;
/** The limits of the last session: a bake prepared while the context is lost sizes its data by them. */
let limits: BakeLimits | null = null;
let lost = false;
let disposed = false;
let job: Job | null = null;
let textures: { version: number; decoded: Promise<DecodedTextures | null> } | null = null;
/** Test hook: lose the context right before the readback after this many samples. */
let loseBeforeMark: number | null = null;
/** Test hook: the next restore fails to create a session, as a driver that cannot compile the bake program would. */
let failNextRestore = false;

function createSession(): void {
  session = null;
  sessionError = null;
  if (failNextRestore) {
    failNextRestore = false;
    sessionError = new PathTracerError('WEBGL2_UNAVAILABLE', 'test hook: the restored context could not bake');
    return;
  }
  if (!gl) {
    sessionError = new PathTracerError('WEBGL2_UNAVAILABLE', 'WebGL2 is not available on an OffscreenCanvas here');
    return;
  }
  try {
    session = new BakeSession(gl);
    limits = session.limits;
  } catch (error) {
    sessionError = error;
  }
}

/** Why there is no session (a failed creation or restore). */
function sessionFailure(): unknown {
  return sessionError instanceof Error
    ? sessionError
    : new PathTracerError('WEBGL2_UNAVAILABLE', 'the bake has no WebGL2 context');
}

/** The event-driven flag lags behind: a readback on a context lost a moment ago returns zeros without an error. */
const contextGone = (): boolean => lost || !gl || gl.isContextLost();

createSession();

// One task later, without the clamping of nested timers.
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });

/** Waits, yielding to messages, until the GPU finished what was drawn: at most one draw in flight. */
async function gpuIdle(context: WebGL2RenderingContext): Promise<void> {
  const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
  context.flush();
  if (!fence) return;
  for (let poll = 0; poll < MAX_FENCE_POLLS; poll++) {
    await nextTask();
    if (contextGone()) return;
    if (context.getSyncParameter(fence, context.SYNC_STATUS) === context.SIGNALED) {
      context.deleteSync(fence);
      return;
    }
  }
  context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));
  context.deleteSync(fence);
}

/** Test hook: the context is lost now (`isContextLost` at once, the event later) and restored on a later task. */
function loseNow(): void {
  const extension = gl?.getExtension('WEBGL_lose_context');
  if (!extension) return;
  canvas.addEventListener('webglcontextlost', () => setTimeout(() => extension.restoreContext(), 0), { once: true });
  extension.loseContext();
}

function post(message: BakeReply, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function errorReply(id: number, error: unknown): BakeReply {
  if (error instanceof PathTracerError || error instanceof RendererError) {
    const message = error.message.replace(/ \(at [^)]*\)$/, '');
    return { type: 'error', id, name: 'PathTracerError', code: error.code, message, path: error.path };
  }
  const name = error instanceof Error ? error.name : 'Error';
  return {
    type: 'error',
    id,
    name,
    code: '',
    message: error instanceof Error ? error.message : String(error),
    path: '',
  };
}

function halves(sums: Float32Array, samples: number): Uint16Array {
  const out = new Uint16Array(sums.length);
  for (let i = 0; i < sums.length; i++) out[i] = toHalf((sums[i] ?? 0) / samples);
  return out;
}

function lightingOf(current: Job, scene: BakeScene, active: BakeSession, samples: number): BakedLighting | null {
  const model = active.read('model');
  const catcherSums = scene.catcher ? active.read('catcher') : null;
  if (!model || contextGone()) return null;
  return {
    layoutKey: current.layoutKey,
    width: scene.charts.width,
    height: scene.charts.height,
    data: halves(model, samples),
    samples,
    catcher:
      scene.catcher && catcherSums
        ? {
            y: scene.catcher.y,
            rect: scene.catcher.rect,
            width: scene.catcher.width,
            height: scene.catcher.height,
            data: halves(catcherSums, samples),
          }
        : null,
  };
}

/**
 * Draws the job's samples tile by tile, reporting at the progress marks; returns when done, stopped or lost. A lost
 * context leaves the job in place: the restore handler starts it again.
 */
async function run(current: Job): Promise<void> {
  const scene = current.scene;
  const active = session;
  if (!scene || !active || !gl) return;
  active.clear();
  const passes: BakePass[] = scene.catcher ? ['model', 'catcher'] : ['model'];
  const tiles = {
    model: sampleTiles(scene.charts.width, scene.charts.height, current.tileSize),
    catcher: scene.catcher ? sampleTiles(scene.catcher.width, scene.catcher.height, current.tileSize) : [],
  };
  const marks = new Set(progressSamples(current.samples));
  for (let sample = 0; sample < current.samples; sample++) {
    for (const pass of passes) {
      for (const tile of tiles[pass]) {
        if (current.stopped || contextGone() || session !== active) return;
        active.drawTile(pass, scene, current.seed, sample, tile, current.countCapped);
        await gpuIdle(gl);
      }
      if (current.stopped || contextGone() || session !== active) return;
      active.finishSample(pass);
    }
    const done = sample + 1;
    if (!marks.has(done)) continue;
    if (loseBeforeMark === done) {
      loseBeforeMark = null;
      loseNow();
    }
    const lighting = lightingOf(current, scene, active, done);
    if (!lighting) return;
    const transfer: Transferable[] = [lighting.data.buffer];
    if (lighting.catcher) transfer.push(lighting.catcher.data.buffer);
    if (done < current.samples) {
      post({ type: 'progress', id: current.id, lighting }, transfer);
    } else {
      job = null;
      post({ type: 'done', id: current.id, lighting, warnings: current.warnings }, transfer);
    }
  }
}

/**
 * Starts decoding the request's textures and keeps them under its version, before anything of the bake can fail:
 * the main thread counts them as sent once posted, and a later bake of the same textures posts no bytes.
 */
function keepTextures(request: Extract<BakeRequest, { type: 'bake' }>): void {
  const previous = textures;
  const decoded = decodeTextures(
    request.doc.textures,
    {
      maxTextureSide: Math.min(MAX_TEXTURE_SIDE, limits?.maxTextureSize ?? MAX_TEXTURE_SIDE),
      maxTexturePixelsTotal: DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
    },
    () => !disposed,
  );
  textures = { version: request.texturesVersion, decoded };
  // The previous images are only needed by a job this request stops.
  void previous?.decoded.then((old) => {
    for (const bitmap of old?.bitmaps ?? []) bitmap?.close();
  });
}

/** Everything that can fail runs here, before the job's scene replaces anything on the GPU. */
async function prepare(
  current: Job,
  request: Extract<BakeRequest, { type: 'bake' }>,
  decodedTextures: Promise<DecodedTextures | null>,
): Promise<void> {
  // While the context is lost the bake is prepared all the same and starts once it is back.
  if (!session && !lost) throw sessionFailure();
  if (!limits) throw new PathTracerError('WEBGL2_UNAVAILABLE', 'the bake context was lost before it could start');
  const doc: SceneDocument = request.doc;
  try {
    validateScene(doc);
  } catch (error) {
    if (error instanceof RendererError) {
      throw new PathTracerError('INVALID_SCENE', error.message.replace(/ \(at [^)]*\)$/, ''), error.path);
    }
    throw error;
  }
  const { maxTextureSize, maxArrayTextureLayers: maxLayers } = limits;
  const layerSide = Math.min(maxTextureSize, MAX_TEXTURE_SIDE);
  checkMaterialCount(doc.materials.length);
  const layout = lightmapLayout(doc);
  const flat = flattenScene(doc, request.maxTriangles);
  const bvh = buildBvh(flat.positions, flat.count);
  const geometry = packGeometry(flat, bvh, maxTextureSize);
  const charts = buildChartTable(layout, flat, bvh.order, maxTextureSize);
  const catcher = request.shadowCatcher
    ? shadowCatcherPlane(sceneBounds(doc), LIGHT_RIG_V0.keyDirection, layout.finestTexel)
    : null;
  const decoded = await decodedTextures;
  if (!decoded) throw new PathTracerError('WEBGL2_UNAVAILABLE', 'the bake worker was disposed');
  const placed = layoutTextures(decoded.bitmaps, layerSide, maxLayers);
  current.scene = {
    geometry,
    materials: packMaterials(doc, placed.textures),
    plan: placed.plan,
    images: placed.images,
    charts,
    catcher,
  };
  current.layoutKey = layout.layoutKey;
  const warnings: PathTracerWarning[] = [];
  if (flat.skipped > 0) {
    warnings.push({
      code: 'DEGENERATE_TRIANGLES',
      count: flat.skipped,
      message: `${flat.skipped} triangles skipped: a position, normal or UV is not finite, or the triangle has no area`,
    });
  }
  for (const warning of decoded.warnings) warnings.push({ ...warning });
  current.warnings = warnings;
}

/** Uploads the job's scene and runs it; a failure (an RGBA32F target the driver rejects) is the job's error. */
async function launch(current: Job): Promise<void> {
  const scene = current.scene;
  if (!scene || current.stopped) return;
  if (!session) {
    // Lost: the restore handler starts the job. Otherwise the restore (or the first creation) failed: settle the bake.
    if (contextGone()) return;
    if (job === current) job = null;
    post(errorReply(current.id, sessionFailure()));
    return;
  }
  try {
    session.upload(scene);
    await run(current);
  } catch (error) {
    // On a lost context GL calls fail quietly; the restore handler starts the job again.
    if (contextGone() || current.stopped) return;
    if (job === current) job = null;
    post(errorReply(current.id, error));
  }
}

async function start(request: Extract<BakeRequest, { type: 'bake' }>): Promise<void> {
  if (job) {
    job.stopped = true;
    post({ type: 'stopped', id: job.id });
    job = null;
  }
  if (request.texturesIncluded) {
    keepTextures(request);
  } else if (textures?.version !== request.texturesVersion) {
    post({ type: 'resend', id: request.id });
    return;
  }
  const decodedTextures = textures?.decoded ?? Promise.resolve(null);
  const current: Job = {
    id: request.id,
    seed: request.seed,
    samples: request.samples,
    tileSize: request.tileSize,
    countCapped: request.countCapped,
    stopped: false,
    scene: null,
    layoutKey: '',
    warnings: [],
  };
  job = current;
  try {
    await prepare(current, request, decodedTextures);
  } catch (error) {
    if (job === current) job = null;
    if (!current.stopped) post(errorReply(current.id, error));
    return;
  }
  if (current.stopped || !current.scene || contextGone()) return;
  await launch(current);
}

if (gl) {
  canvas.addEventListener('webglcontextlost', (event) => {
    // Without preventDefault the context never comes back.
    event.preventDefault();
    lost = true;
    session = null;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (disposed) return;
    lost = false;
    createSession();
    const current = job;
    if (!current?.scene || current.stopped) return;
    if (!session) {
      job = null;
      post(errorReply(current.id, sessionFailure()));
      return;
    }
    post({ type: 'restarted', id: current.id });
    void launch(current);
  });
}

scope.addEventListener('message', (event: MessageEvent<BakeRequest>) => {
  const request = event.data;
  if (disposed) return;
  if (request.type === 'bake') {
    start(request).catch((error: unknown) => post(errorReply(request.id, error)));
  } else if (request.type === 'loseContext') {
    if (request.failRestore) failNextRestore = true;
    if (request.beforeMark !== undefined) loseBeforeMark = request.beforeMark;
    else loseNow();
  } else {
    disposed = true;
    if (job) {
      job.stopped = true;
      post({ type: 'stopped', id: job.id });
      job = null;
    }
    if (!lost) session?.dispose();
    session = null;
    void (textures?.decoded ?? Promise.resolve(null)).then((decoded) => {
      for (const bitmap of decoded?.bitmaps ?? []) bitmap?.close();
      post({ type: 'disposed' });
    });
  }
});
