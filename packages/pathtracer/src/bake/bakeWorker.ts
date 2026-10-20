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
import { BakeSession, type BakePass, type BakeScene } from './BakeSession';
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
let lost = false;
let disposed = false;
let job: Job | null = null;
let textures: { version: number; decoded: Promise<DecodedTextures | null> } | null = null;

function createSession(): void {
  session = null;
  sessionError = null;
  if (!gl) {
    sessionError = new PathTracerError('WEBGL2_UNAVAILABLE', 'WebGL2 is not available on an OffscreenCanvas here');
    return;
  }
  try {
    session = new BakeSession(gl);
  } catch (error) {
    sessionError = error;
  }
}

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
  for (let poll = 0; poll < MAX_FENCE_POLLS; poll++) {
    await nextTask();
    if (lost || !fence) return;
    if (context.getSyncParameter(fence, context.SYNC_STATUS) === context.SIGNALED) {
      context.deleteSync(fence);
      return;
    }
  }
  context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));
  context.deleteSync(fence);
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
  return { type: 'error', id, name, code: '', message: error instanceof Error ? error.message : String(error), path: '' };
}

function halves(sums: Float32Array, samples: number): Uint16Array {
  const out = new Uint16Array(sums.length);
  for (let i = 0; i < sums.length; i++) out[i] = toHalf((sums[i] ?? 0) / samples);
  return out;
}

function lightingOf(current: Job, scene: BakeScene, active: BakeSession, samples: number): BakedLighting | null {
  const model = active.read('model');
  if (!model) return null;
  const catcherSums = scene.catcher ? active.read('catcher') : null;
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

/** Draws the job's samples tile by tile, reporting at the progress marks; returns when done, stopped or lost. */
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
        if (current.stopped || lost || session !== active) return;
        active.drawTile(pass, scene, current.seed, sample, tile);
        await gpuIdle(gl);
      }
      if (current.stopped || lost || session !== active) return;
      active.finishSample(pass);
    }
    const done = sample + 1;
    if (!marks.has(done)) continue;
    const lighting = lightingOf(current, scene, active, done);
    if (!lighting || lost) return;
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

function texturesFor(request: Extract<BakeRequest, { type: 'bake' }>, maxTextureSize: number) {
  if (request.texturesIncluded || textures?.version !== request.texturesVersion) {
    const previous = textures;
    const decoded = decodeTextures(
      request.doc.textures,
      {
        maxTextureSide: Math.min(MAX_TEXTURE_SIDE, maxTextureSize),
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
  return textures.decoded;
}

/** Everything that can fail runs here, before the job's scene replaces anything on the GPU. */
async function prepare(current: Job, request: Extract<BakeRequest, { type: 'bake' }>): Promise<void> {
  if (!session) throw sessionError ?? new PathTracerError('WEBGL2_UNAVAILABLE', 'the bake context is lost');
  const doc: SceneDocument = request.doc;
  try {
    validateScene(doc);
  } catch (error) {
    if (error instanceof RendererError) {
      throw new PathTracerError('INVALID_SCENE', error.message.replace(/ \(at [^)]*\)$/, ''), error.path);
    }
    throw error;
  }
  const maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const layerSide = Math.min(maxTextureSize, MAX_TEXTURE_SIDE);
  const maxLayers = gl?.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  checkMaterialCount(doc.materials.length);
  const layout = lightmapLayout(doc);
  const flat = flattenScene(doc, request.maxTriangles);
  const bvh = buildBvh(flat.positions, flat.count);
  const geometry = packGeometry(flat, bvh, maxTextureSize);
  const charts = buildChartTable(layout, flat, bvh.order, maxTextureSize);
  const catcher = request.shadowCatcher
    ? shadowCatcherPlane(sceneBounds(doc), LIGHT_RIG_V0.keyDirection, layout.finestTexel)
    : null;
  const decoded = await texturesFor(request, maxTextureSize);
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

async function start(request: Extract<BakeRequest, { type: 'bake' }>): Promise<void> {
  if (job) {
    job.stopped = true;
    post({ type: 'stopped', id: job.id });
  }
  const current: Job = {
    id: request.id,
    seed: request.seed,
    samples: request.samples,
    tileSize: request.tileSize,
    stopped: false,
    scene: null,
    layoutKey: '',
    warnings: [],
  };
  job = current;
  try {
    await prepare(current, request);
  } catch (error) {
    if (job === current) job = null;
    if (!current.stopped) post(errorReply(current.id, error));
    return;
  }
  if (current.stopped || !current.scene) return;
  if (lost) return;
  session?.upload(current.scene);
  await run(current);
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
      post(errorReply(current.id, sessionError));
      return;
    }
    session.upload(current.scene);
    post({ type: 'restarted', id: current.id });
    void run(current);
  });
}

scope.addEventListener('message', (event: MessageEvent<BakeRequest>) => {
  const request = event.data;
  if (disposed) return;
  if (request.type === 'bake') {
    void start(request);
  } else if (request.type === 'loseContext') {
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return;
    canvas.addEventListener('webglcontextlost', () => setTimeout(() => extension.restoreContext(), 0), { once: true });
    extension.loseContext();
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
