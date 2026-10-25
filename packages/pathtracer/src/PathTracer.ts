import {
  DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
  RendererError,
  canvasSize,
  decodeTextures,
  shadowCatcherPlane,
  validateScene,
  type ShadowCatcherPlane,
  type CanvasCssSize,
  type CanvasSize,
  type RawImage,
  type TextureLimits,
} from '@modelshot/renderer-rt';
import {
  BACK_SIDE_RENDER_ORDER,
  RENDER_ORDER_TIE_DISTANCE,
  SCENE_FORMAT_VERSION,
  type SceneBounds,
  type SceneCamera,
  type SceneDocument,
} from '@modelshot/scene';
import {
  DEFAULT_LOOK,
  MAX_EDGE_WIDTH,
  checkBackground,
  checkEdgeLook,
  checkLookPreset,
  LOOK_VIEW_NONE,
  lookView,
  uploadLookUniforms,
  type EdgeLook,
  type LookPreset,
} from '@modelshot/looks';
import { AccumulationTargets } from './accumulationTargets';
import { buildBvh } from './buildBvh';
import { cameraUniforms, type CameraUniforms } from './cameraUniforms';
import { flatEdges, flattenScene, visibleTriangleCount, DEFAULT_MAX_TRIANGLES } from './flattenScene';
import { GeometryBuilder } from './geometry/GeometryBuilder';
import { disposeGpuScene, uploadGpuScene, type GpuScene } from './gpuScene';
import {
  DATA_TEXTURE_WIDTH,
  checkMaterialCount,
  packGeometry,
  packMaterials,
  packTriangleEdges,
  type PackedGeometry,
} from './packSceneData';
import { PathTracerError } from './PathTracerError';
import type {
  PathTracerOptions,
  RenderedImage,
  RenderRequest,
  SetSceneOptions,
  SetSceneResult,
} from './PathTracerOptions';
import type { PathTracerWarning } from './PathTracerWarning';
import { isCheckpoint, sampleTiles, samplesToDraw, type Tile } from './sampleSchedule';
import { noiseQuantile } from './noiseQuantile';
import { checkRenderQuality, supersampledScale, type RenderQuality, type TargetLimits } from './renderQuality';
import { estimateRemainingMs, type RenderProgress } from './renderProgress';
import { ResolveTargets, type ResolveLayout } from './resolveTargets';
import { requireExactAccumulation } from './requireExactAccumulation';
import { layoutTextures } from './layoutTextures';
import type { TextureLayerPlan } from './textureLayers';
import { TracerPrograms, type QualityProgramName, type TracerProgram } from './tracerPrograms';
import { uploadSceneInBands } from './uploadSceneInBands';

const DEFAULT_MAX_BOUNCES = 4;
const MAX_BOUNCES = 16;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_MAX_TEXTURE_SIDE = 4096;
export const MAX_SAMPLES = 65536;
export const MAX_SEED = 2 ** 32 - 1;
const DEFAULT_QUALITY: RenderQuality = { supersample: 1, denoise: false, noiseThreshold: null };
// Iterations of the à-trous filter: taps 1, 2, 4, 8 and 16 pixels apart, a footprint of 125 pixels.
const DENOISE_ITERATIONS = 5;
// Camera rays per pixel of the denoiser's guides, and where one meets a partial texel (guide.frag).
const GUIDE_RAYS = 64;
const PARTIAL_GUIDE_RAYS = 1024;
// A guide pixel at a partial texel traces 1024 camera rays, a trace pixel about ten rays per sample: the guide draws
// in tiles this many times narrower (64 times fewer pixels), so its draw calls stay as short as a sample's.
const GUIDE_TILE_DIVISOR = 8;
// Texture units: the scene data takes 1..5 in the trace and the guide.
const UNIT_SUM = 0;
const UNIT_MOMENTS = 6;
const UNIT_COVERAGE = 7;

const NOT_APPLIED: SetSceneResult = Object.freeze({ applied: false, warnings: Object.freeze([]), triangles: 0 });
const noop = (): void => undefined;

const EMPTY_SCENE: SceneDocument = {
  formatVersion: SCENE_FORMAT_VERSION,
  source: { format: 'bbmodel', formatVersion: '', modelFormat: 'unknown' },
  nodes: [],
  meshes: [],
  materials: [],
  textures: [],
  rootNodes: [],
};

/** What this context can do; queried at creation and again after a context restore. */
export interface PathTracerCapabilities {
  readonly maxTextureSize: number;
  readonly maxArrayTextureLayers: number;
  /** Side of the texture layers (min of MAX_TEXTURE_SIZE and 4096). */
  readonly layerSide: number;
  /** Unmasked renderer string when the browser exposes it. */
  readonly renderer: string;
}

/** A scene as kept on the CPU, so a lost context can be rebuilt without decoding or building again. */
interface LoadedScene {
  readonly doc: SceneDocument;
  /** `FlatScene.sources` and the BVH order: what rewriting the edge texels for another sharp angle needs. */
  readonly sources: Uint32Array;
  readonly order: Uint32Array;
  /** The sharp angle the edge texels were packed with; `setEdges` during a pending `setScene` makes it stale. */
  edgeAngle: number;
  readonly geometry: PackedGeometry;
  readonly materials: ReturnType<typeof packMaterials>;
  /** `SetSceneOptions.emission` as passed: a later call with the same textures reuses `materials` when it matches. */
  readonly emission: SetSceneOptions['emission'];
  /** The material table's texture entries (`layoutTextures`), for packing the table of a later call that reuses them. */
  readonly materialTextures: ReturnType<typeof layoutTextures>['textures'];
  readonly textureWarnings: readonly PathTracerWarning[];
  readonly plan: TextureLayerPlan;
  readonly images: readonly (ImageBitmap | RawImage)[];
  readonly bitmaps: readonly (ImageBitmap | null)[];
  /** Where the catcher goes: `SetSceneOptions.catcherBounds`, else the visible geometry's (`sceneBounds`). */
  readonly bounds: SceneBounds | null;
  /** `SetSceneOptions.shadowCatcher`. */
  readonly catcherOn: boolean;
  /** The shadow catcher camera rays see, under the current look's key; `null` when off or without bounds. */
  catcher: ShadowCatcherPlane | null;
}

interface Gpu {
  readonly capabilities: PathTracerCapabilities;
  readonly programs: TracerPrograms;
  readonly vao: WebGLVertexArrayObject;
  scene: GpuScene | null;
  targets: AccumulationTargets | null;
  /** The quality path's guides, filter, resolved image and noise blocks; `null` for a plain request. */
  resolve: ResolveTargets | null;
  /** The largest render target on each axis, queried with the context. */
  readonly targetLimits: TargetLimits;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** `SetSceneOptions.catcherBounds` with finite `min ≤ max`, as a plain copy; anything else throws a `RangeError`. */
function checkCatcherBounds(value: unknown): SceneBounds {
  const fields = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const corner = (name: 'min' | 'max'): [number, number, number] => {
    const v = fields[name];
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      throw new RangeError(`catcherBounds.${name} must be 3 finite numbers`);
    }
    return [v[0] as number, v[1] as number, v[2] as number];
  };
  const min = corner('min');
  const max = corner('max');
  if (min.some((m, k) => m > (max[k] as number))) throw new RangeError('catcherBounds needs min ≤ max on each axis');
  return {
    min,
    max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  };
}

/** The two emission tables give every material the same glow (`packMaterials` reads them by index). */
function sameEmission(a: SetSceneOptions['emission'], b: SetSceneOptions['emission']): boolean {
  const left = a ?? [];
  const right = b ?? [];
  const count = Math.max(left.length, right.length);
  for (let m = 0; m < count; m++) {
    const x = left[m];
    const y = right[m];
    if (x === y) continue;
    if (!x || !y || x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2]) return false;
  }
  return true;
}

function checkInteger(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in ${min}..${max}, got ${String(value)}`);
  }
  return value;
}

/**
 * WebGL2 path tracer of a `SceneDocument` with the preview's camera, materials, alpha rule, sides, render order, light
 * rig and tone mapping. Progressive and deterministic: `start({ seed, samples })` asks for exactly `samples` samples
 * per pixel, each `step()` adds some, and the image depends only on scene, camera, size, seed and sample count, never
 * on how the samples were batched or tiled. No clock and no animation loop: the caller paces `step()`. Survives
 * context loss: drawing pauses, and on restore every GPU resource is rebuilt and the request restarts at sample 0.
 */
export class PathTracer {
  private gpu: Gpu | null = null;
  private loaded: LoadedScene | null = null;
  private camera: SceneCamera | null = null;
  private request: RenderRequest | null = null;
  private quality: RenderQuality = DEFAULT_QUALITY;
  /** `RenderRequest.transparent` of the current request. */
  private transparent = false;
  /** The supersampling scale the current request traces at: set by `start`, `resize` and a restore, never on a read. */
  private scale = 1;
  private done = 0;
  /** The denoiser's guides are drawn for the current request. */
  private guided = false;
  /** The 0.99 quantile of the noise estimate and the sample count it was measured at. */
  private noise: number | null = null;
  private noiseSamples = 0;
  private converged = false;
  /** Clock readings of the request's first step and the end of its latest one; progress only, never a pixel. */
  private startedAt: number | null = null;
  private lastStepAt = 0;
  private cancelled = false;
  private generation = 0;
  /** Settles once every `setScene` geometry build started so far has (`GeometryBuilder` settles them in call order). */
  private geometryTail: Promise<void> = Promise.resolve();
  /** Counts context losses: textures made before a loss are dead even after the restore. */
  private contextEpoch = 0;
  private lost = false;
  private disposed = false;
  private readonly restoredListeners = new Set<() => void>();
  /** The look drawn with, but for its edges, which are `edges` (`setEdges` changes them alone). */
  private lookPreset: LookPreset;
  private readonly maxBounces: number;
  private readonly tileSize: number;
  private edges: EdgeLook;
  private readonly builder: GeometryBuilder;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly options: PathTracerOptions,
  ) {
    const look = checkLookPreset(options.look ?? DEFAULT_LOOK);
    const background = options.background ? checkBackground(options.background) : undefined;
    // Checked again so the look getter hands out a frozen preset in this case too.
    this.lookPreset = background
      ? checkLookPreset({ ...look, backdrop: { top: background, bottom: background } })
      : look;
    this.maxBounces = checkInteger('maxBounces', options.maxBounces ?? DEFAULT_MAX_BOUNCES, 1, MAX_BOUNCES);
    this.tileSize = checkInteger('tileSize', options.tileSize ?? DEFAULT_TILE_SIZE, 16, 4096);
    this.edges = checkEdgeLook(options.edges, look.edges);
    this.builder = GeometryBuilder.create(options.geometryWorker !== false);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    try {
      this.gpu = this.createGpu();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * Creates the WebGL2 context on `canvas`. Throws `PathTracerError` `WEBGL2_UNAVAILABLE`, `FLOAT_TARGETS_UNAVAILABLE`
   * or `HIGHP_UNAVAILABLE` (no exact accumulation here; the preview still works) or a shader error, a
   * `LookPresetError` for an invalid `look`, and a `RangeError` for an option out of range.
   */
  static create(canvas: HTMLCanvasElement, options: PathTracerOptions = {}): PathTracer {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new PathTracerError('WEBGL2_UNAVAILABLE', 'WebGL2 is not available in this browser');
    return new PathTracer(canvas, gl, options);
  }

  get capabilities(): PathTracerCapabilities | null {
    return this.gpu?.capabilities ?? null;
  }

  /**
   * `setScene` builds the geometry in a worker: `false` with the `geometryWorker` option off, without Worker support,
   * or once the worker could not start or failed (the main thread builds it then).
   */
  get geometryInWorker(): boolean {
    return this.builder.inWorker;
  }

  /** The context is lost: from the moment it is, before its event too. */
  get contextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /** Samples per pixel accumulated for the current request. */
  get samplesDone(): number {
    return this.done;
  }

  /** Samples per pixel the current request asks for; 0 before `start`. */
  get targetSamples(): number {
    return this.request?.samples ?? 0;
  }

  /** `step()` would draw more: a request is running, not cancelled, not converged and not complete. */
  get running(): boolean {
    return this.request !== null && !this.cancelled && !this.converged && this.done < this.request.samples;
  }

  /** Where the current request stands, with an estimate of the time left; times never change a pixel. */
  get progress(): RenderProgress {
    const samplesDone = this.done;
    const targetSamples = this.targetSamples;
    const elapsedMs = this.startedAt === null ? 0 : this.lastStepAt - this.startedAt;
    const finished = this.request !== null && !this.running;
    return {
      samplesDone,
      targetSamples,
      supersample: this.scale,
      noise: this.noise,
      converged: this.converged,
      elapsedMs,
      remainingMs: estimateRemainingMs({
        samplesDone,
        targetSamples,
        elapsedMs,
        finished,
        noiseThreshold: this.quality.noiseThreshold,
        noise: this.noise,
        noiseSamples: this.noiseSamples,
      }),
    };
  }

  /** Width of the traced image, `readAccumulation`'s: the canvas width times `progress.supersample`. */
  get accumulationWidth(): number {
    return this.canvas.width * this.scale;
  }

  get accumulationHeight(): number {
    return this.canvas.height * this.scale;
  }

  /**
   * Validates `doc` (`PathTracerError` `INVALID_SCENE`), checks its material count, its visible triangles
   * (`SCENE_TOO_LARGE`, from the group counts alone) and `catcherBounds` (`RangeError`), all before the first `await`
   * and before anything is posted. Then the geometry worker (`PathTracerOptions.geometryWorker`) flattens the triangles,
   * builds the BVH and packs the data (`SCENE_TOO_LARGE` for rows over MAX_TEXTURE_SIZE before the arrays are
   * allocated) while the main thread streams it the meshes over several tasks; then the textures are decoded and laid
   * out (`SCENE_TOO_LARGE` over MAX_ARRAY_TEXTURE_LAYERS, the decoded images closed), the data uploads in bands over
   * several tasks while the current scene keeps drawing, and the scene is swapped in; the accumulation restarts at
   * sample 0. Nothing reaches the GPU before every check passed, and a failing call keeps the current scene. A later
   * call that passes every limit (whenever its geometry arrives) or `dispose()` supersedes a pending one: it resolves
   * with `applied: false` and closes what it decoded. A later call rejected for a limit supersedes nothing.
   * Meshes are compared by object identity: a `SceneMesh` mutated in place between calls is not posted again, so
   * change one by passing a new object. So is the `textures` array of the shown scene: the same array skips decoding,
   * layout and the texture upload (the decoded images and the GPU layer texture stay), and the same `materials` array
   * with equal `emission` keeps the material table too, so only the geometry is built and uploaded; a call with a
   * changed texture needs a new array, one mutated in place is not seen. Animation poses of one model share the arrays.
   * The result and the pixels equal those of a call with new arrays.
   */
  async setScene(doc: SceneDocument, options: SetSceneOptions = {}): Promise<SetSceneResult> {
    if (this.disposed) return NOT_APPLIED;
    try {
      validateScene(doc);
    } catch (error) {
      if (error instanceof RendererError) {
        throw new PathTracerError('INVALID_SCENE', error.message.replace(/ \(at [^)]*\)$/, ''), error.path);
      }
      throw error;
    }
    const capabilities = this.capabilities ?? this.queryCapabilities();
    checkMaterialCount(doc.materials.length);
    const maxTriangles = this.options.maxTriangles ?? DEFAULT_MAX_TRIANGLES;
    visibleTriangleCount(doc, maxTriangles);
    const catcherBounds = options.catcherBounds === undefined ? undefined : checkCatcherBounds(options.catcherBounds);
    const catcherOn = options.shadowCatcher !== false;
    const packedAngle = this.edges.sharpAngleDeg;
    const build = this.builder.build(doc, {
      maxTriangles,
      edges: this.sharpEdgeOptions(),
      maxTextureSize: capabilities.maxTextureSize,
      sceneBounds: catcherBounds === undefined,
    });
    this.geometryTail = build.then(noop, noop);
    const prepared = await build;
    if (!prepared || this.disposed) return NOT_APPLIED;
    // Builds settle in call order, so generations follow the calls; a call whose build rejected supersedes nothing.
    const generation = ++this.generation;
    // The shown scene's decoded textures serve a document that shares its textures array.
    const base = this.loaded?.doc.textures === doc.textures ? this.loaded : null;
    let bitmaps: readonly (ImageBitmap | null)[];
    let textureWarnings: readonly PathTracerWarning[];
    let layout: Pick<LoadedScene, 'plan' | 'images'> & { textures: LoadedScene['materialTextures'] };
    if (base) {
      bitmaps = base.bitmaps;
      textureWarnings = base.textureWarnings;
      layout = { plan: base.plan, images: base.images, textures: base.materialTextures };
      if (!this.isCurrent(generation)) return NOT_APPLIED;
    } else {
      const decoded = await decodeTextures(doc.textures, this.textureLimits(capabilities), () =>
        this.isCurrent(generation),
      );
      if (!decoded) return NOT_APPLIED;
      bitmaps = decoded.bitmaps;
      textureWarnings = decoded.warnings;
      // Everything that can still fail runs before the current scene is released: a failure keeps it and closes the
      // images this call decoded.
      try {
        layout = layoutTextures(bitmaps, capabilities.layerSide, capabilities.maxArrayTextureLayers);
      } catch (error) {
        for (const bitmap of bitmaps) bitmap?.close();
        throw error;
      }
    }
    // Images this call decoded are its own to close; those of `base` belong to the shown scene.
    const closeOwn = (): void => {
      if (!base) for (const bitmap of bitmaps) bitmap?.close();
    };
    const sameMaterials =
      base !== null && doc.materials === base.doc.materials && sameEmission(options.emission, base.emission);
    let loaded: LoadedScene;
    try {
      loaded = {
        doc,
        sources: prepared.sources,
        edgeAngle: packedAngle,
        order: prepared.order,
        geometry: prepared.geometry,
        materials: sameMaterials ? base.materials : packMaterials(doc, layout.textures, options.emission),
        emission: options.emission?.map((glow) => glow && ([...glow] as [number, number, number])),
        materialTextures: layout.textures,
        textureWarnings,
        plan: layout.plan,
        images: layout.images,
        bitmaps,
        bounds: catcherBounds ?? prepared.bounds,
        catcherOn,
        catcher: null,
      };
    } catch (error) {
      closeOwn();
      throw error;
    }
    const sharing = base ? { materials: sameMaterials } : null;
    let uploaded: GpuScene | null;
    let shown: GpuScene | null;
    try {
      const result = await this.uploadInBands(loaded, generation, sharing);
      uploaded = result.scene;
      shown = result.shown;
    } catch (error) {
      closeOwn();
      throw error;
    }
    if (!this.isCurrent(generation)) {
      if (uploaded) disposeGpuScene(this.gl, uploaded, this.gpu?.scene);
      closeOwn();
      return NOT_APPLIED;
    }
    // setEdges or a restore replaced the scene shown at the upload: the handles borrowed from it are gone, and rows
    // written before a sharp angle was changed and changed back are stale.
    if (uploaded && this.gpu?.scene !== shown) {
      disposeGpuScene(this.gl, uploaded, this.gpu?.scene);
      uploaded = null;
    }
    this.releaseScene(loaded, uploaded);
    this.loaded = loaded;
    // Placed under the look current at the swap: a setLook while the scene was prepared applies to it too.
    loaded.catcher = catcherOn ? this.catcherPlane(loaded.bounds) : null;
    const gpu = this.gpu;
    if (uploaded && gpu && loaded.edgeAngle === this.edges.sharpAngleDeg) {
      gpu.scene = uploaded;
    } else {
      if (uploaded) disposeGpuScene(this.gl, uploaded, gpu?.scene);
      // A sharp angle set during the upload, or nothing uploaded (no context, or lost: the restore uploads then).
      this.repackEdges(loaded);
      if (gpu && !this.lost && !this.gl.isContextLost()) this.uploadLoaded(gpu);
    }
    this.restart();
    const warnings: PathTracerWarning[] = [];
    if (prepared.skipped > 0) {
      warnings.push({
        code: 'DEGENERATE_TRIANGLES',
        count: prepared.skipped,
        message: `${prepared.skipped} triangles skipped: a position, normal or UV is not finite, or the triangle has no area`,
      });
    }
    for (const warning of textureWarnings) warnings.push({ ...warning });
    return { applied: true, warnings, triangles: prepared.count };
  }

  /**
   * Uploads `loaded` in bands while the current scene keeps drawing, after and before waiting for every geometry build
   * started meanwhile (a later call that passes its limits supersedes this one even when its geometry arrives last).
   * `scene` is `null` without a context to upload to, or when superseded or the context was lost during the upload.
   * With `sharing` the shown scene's layer texture (and its material table when `sharing.materials`) goes into the
   * result as is. `shown` is the scene on the GPU when the upload started.
   */
  private async uploadInBands(
    loaded: LoadedScene,
    generation: number,
    sharing: { materials: boolean } | null,
  ): Promise<{ scene: GpuScene | null; shown: GpuScene | null }> {
    await this.buildsSettled();
    const gpu = this.gpu;
    if (!this.isCurrent(generation) || !gpu || this.lost) return { scene: null, shown: null };
    const epoch = this.contextEpoch;
    this.repackEdges(loaded);
    const shown = gpu.scene;
    const sharedFrom = sharing && shown && !this.gl.isContextLost() ? shown : null;
    const uploaded = await uploadSceneInBands(
      this.gl,
      loaded.geometry,
      loaded.materials,
      loaded.plan,
      loaded.images,
      () => this.isCurrent(generation) && this.contextEpoch === epoch && this.gpu === gpu,
      sharedFrom
        ? { layers: sharedFrom.layers, ...(sharing?.materials ? { materials: sharedFrom.materials } : {}) }
        : {},
    );
    await this.buildsSettled();
    // A context lost and restored while waiting: the textures belong to the dead one, the restore uploads instead.
    if (uploaded && (this.contextEpoch !== epoch || this.gpu !== gpu)) {
      disposeGpuScene(this.gl, uploaded);
      return { scene: null, shown: null };
    }
    return { scene: uploaded, shown };
  }

  /** Resolves once no geometry build is pending, one started while waiting included. */
  private async buildsSettled(): Promise<void> {
    let tail: Promise<void>;
    do {
      tail = this.geometryTail;
      await tail;
    } while (tail !== this.geometryTail);
  }

  /** The look drawn with: the last `setLook` (or the options' look and overrides) with the current edges. */
  get look(): LookPreset {
    const look = this.lookPreset;
    const same = look.edges.width === this.edges.width && look.edges.sharpAngleDeg === this.edges.sharpAngleDeg;
    return same ? look : Object.freeze({ ...look, edges: Object.freeze({ ...this.edges }) });
  }

  /**
   * Renders with `look` (`RealtimeRenderer.setLook` of the preview takes the same): its lights, environment, backdrop,
   * catcher strength, tone mapping and edges; the shadow catcher moves under the new key. Restarts the accumulation.
   * An invalid look throws `LookPresetError` naming the field and changes nothing. A scene still decoding gets it too.
   */
  setLook(look: LookPreset): void {
    const next = checkLookPreset(look);
    this.lookPreset = next;
    const loaded = this.loaded;
    if (loaded) loaded.catcher = loaded.catcherOn ? this.catcherPlane(loaded.bounds) : null;
    this.setEdges(next.edges);
    this.restart();
  }

  /** The catcher's height and rectangle under the look's key; they do not depend on its texel size (the bake's). */
  private catcherPlane(bounds: SceneBounds | null): ShadowCatcherPlane | null {
    return shadowCatcherPlane(bounds, this.lookPreset.lights.key.direction, 1);
  }

  /** The rounded edges drawn with (`RendererOptions.edges` of the preview takes the same). */
  get edgeLook(): EdgeLook {
    return this.edges;
  }

  /**
   * Changes the rounded edges; fields left out keep their current value. A value out of range throws a `RangeError`
   * naming the field and changes nothing. A new width only restarts the accumulation; a new sharp angle detects the
   * edges again and uploads the triangle data again.
   */
  setEdges(edges: Partial<EdgeLook>): void {
    const next = checkEdgeLook(edges, this.edges);
    const angleChanged = next.sharpAngleDeg !== this.edges.sharpAngleDeg;
    if (!angleChanged && next.width === this.edges.width) return;
    this.edges = next;
    const loaded = this.loaded;
    if (angleChanged && loaded) {
      this.repackEdges(loaded);
      const gpu = this.gpu;
      if (gpu?.scene && !this.lost) {
        disposeGpuScene(this.gl, gpu.scene);
        gpu.scene = null;
        this.uploadLoaded(gpu);
      }
    }
    this.restart();
  }

  /** The shared camera; an unusable projection or clip range throws a `RangeError`. Restarts the accumulation. */
  setCamera(camera: SceneCamera): void {
    cameraUniforms(camera, this.canvas.width / this.canvas.height);
    this.camera = camera;
    this.restart();
  }

  /** Sizes the backing store like the preview (CSS size × pixel ratio within the GPU limits); restarts on a change. */
  resize(size: CanvasCssSize): CanvasSize {
    const result = canvasSize(size, {
      ...this.targetLimits(),
      ...(this.options.maxPixels !== undefined ? { maxPixels: this.options.maxPixels } : {}),
    });
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
      this.updateScale();
      this.restart();
    }
    return result;
  }

  /**
   * Starts a render of exactly `samples` samples per pixel from `seed` (with `noiseThreshold` at most that many),
   * discarding what was accumulated. `seed` must be an integer in 0..2^32 − 1, `samples` in 1..65536, `supersample` in
   * 1..4, `denoise` and `transparent` booleans and `noiseThreshold` in (0, 1], else a `RangeError` naming the field.
   */
  start(request: RenderRequest): void {
    const seed = checkInteger('seed', request.seed, 0, MAX_SEED);
    const samples = checkInteger('samples', request.samples, 1, MAX_SAMPLES);
    const quality = checkRenderQuality(request);
    const transparent: unknown = request.transparent === undefined ? false : request.transparent;
    if (typeof transparent !== 'boolean') {
      throw new RangeError(`transparent must be a boolean, got ${String(transparent)}`);
    }
    this.request = { seed, samples };
    this.quality = quality;
    this.transparent = transparent;
    this.updateScale();
    this.cancelled = false;
    this.restart();
  }

  /**
   * Draws up to `maxSamples` more samples of the current request (never past its count, nor past the checkpoint where
   * it converged), presents the image and returns how many it drew. Supersampled or denoised, the image shown is the
   * one resolved at the latest checkpoint or at the end. A no-op returning 0 without a camera, when complete,
   * converged, cancelled, while the context is lost or after `dispose()`. The first step of a request that needs a
   * quality program links it: a shader failure there throws `PathTracerError` `SHADER_COMPILE` or `SHADER_LINK`.
   */
  step(maxSamples = 1): number {
    const gpu = this.gpu;
    const request = this.request;
    if (!gpu || !request || !this.camera || this.cancelled || this.lost || this.disposed || this.gl.isContextLost()) {
      return 0;
    }
    const count = this.converged ? 0 : samplesToDraw(this.done, request.samples, maxSamples);
    if (count === 0) return 0;
    const targets = this.ensureTargets(gpu);
    this.startedAt ??= performance.now();
    const extra = gpu.resolve;
    const camera = cameraUniforms(this.camera, this.canvas.width / this.canvas.height);
    const tiles = sampleTiles(targets.width, targets.height, this.tileSize);
    const gl = this.gl;
    if (extra?.guide && !this.guided) {
      const guide = gpu.programs.get('guide');
      this.bindScene(gpu, guide, camera, request.seed, targets);
      gl.uniform1ui(guide.uniform('u_guideRays'), GUIDE_RAYS);
      gl.uniform1ui(guide.uniform('u_partialGuideRays'), PARTIAL_GUIDE_RAYS);
      gl.bindFramebuffer(gl.FRAMEBUFFER, extra.guide.framebuffer);
      const guideTile = Math.max(16, Math.floor(this.tileSize / GUIDE_TILE_DIVISOR));
      this.drawTiles(sampleTiles(targets.width, targets.height, guideTile));
      this.guided = true;
    }
    this.bindTrace(gpu, camera, request.seed, targets);
    const trace = gpu.programs.trace;
    const threshold = this.quality.noiseThreshold;
    let drawn = 0;
    let checkpoint = false;
    while (drawn < count) {
      gl.uniform1ui(trace.uniform('u_sample'), this.done);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.next.framebuffer);
      gl.activeTexture(gl.TEXTURE0 + UNIT_SUM);
      gl.bindTexture(gl.TEXTURE_2D, targets.sum.texture);
      gl.activeTexture(gl.TEXTURE0 + UNIT_MOMENTS);
      gl.bindTexture(gl.TEXTURE_2D, targets.sum.moments);
      gl.activeTexture(gl.TEXTURE0 + UNIT_COVERAGE);
      gl.bindTexture(gl.TEXTURE_2D, targets.sum.coverage);
      this.drawTiles(tiles);
      targets.swap();
      this.done++;
      drawn++;
      if (!isCheckpoint(this.done)) continue;
      checkpoint = true;
      // Checkpoints are sample counts, so the stop and the image do not depend on how the samples were batched.
      if (extra?.noise && this.done >= 2) {
        this.measureNoise(gpu, targets, extra);
        // Lost while drawing: the readback holds nothing, and the restore restarts the request anyway.
        if (gl.isContextLost()) break;
        if (threshold !== null && this.noise !== null && this.noise <= threshold) {
          this.converged = true;
          break;
        }
        this.bindTrace(gpu, camera, request.seed, targets);
      }
    }
    this.unbindTextures(UNIT_COVERAGE + 1);
    const finished = this.converged || this.done >= request.samples;
    if (extra?.resolved && (checkpoint || finished)) this.resolveImage(gpu, targets, extra, tiles);
    this.present(gpu);
    this.lastStepAt = performance.now();
    return drawn;
  }

  /**
   * Stops the current request: `step()` draws nothing more until `start`; the image shown stays (supersampled or
   * denoised, the one resolved at the latest step that crossed a checkpoint).
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * The per-pixel float sums of the samples done (rows bottom to top): rgb the radiance (divide by `samplesDone`), a
   * the traversals stopped by the per-ray node cap (0 in any ordinary scene). For a denoiser or a test; `null` while
   * the context is lost (from the moment it is, before its event too, when a read would give zeros) or before a sample.
   */
  readAccumulation(): Float32Array | null {
    const targets = this.gpu?.targets;
    if (!targets || this.lost || this.gl.isContextLost() || this.done === 0) return null;
    return targets.read();
  }

  /**
   * The image presented now as 8-bit sRGB with straight alpha, rows top to bottom: a transparent request's alpha is its
   * coverage (0 where camera rays left the scene, black with alpha 1 − shade on the shadow catcher), any other request's
   * is 255 and its pixels are the canvas's. Supersampled or denoised, the image resolved at the latest checkpoint.
   * `null` while the context is lost (also when it went during the read), after `dispose()` or before a sample.
   */
  readImage(): RenderedImage | null {
    const gpu = this.gpu;
    if (!gpu?.targets || this.lost || this.disposed || this.gl.isContextLost() || this.done === 0) return null;
    const gl = this.gl;
    const { width, height } = this.canvas;
    // A transient RGBA8 target: the canvas stays opaque (no compositing change), and nothing lives past the call.
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const framebuffer = gl.createFramebuffer();
    const data = new Uint8ClampedArray(width * height * 4);
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      this.present(gpu, framebuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    }
    // A context lost during the read leaves zeros, which must not pass for a transparent image.
    if (gl.isContextLost()) return null;
    // Rows come bottom to top: swapped in place, one row of scratch.
    const row = width * 4;
    const scratch = new Uint8ClampedArray(row);
    for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
      scratch.set(data.subarray(top * row, (top + 1) * row));
      data.copyWithin(top * row, bottom * row, (bottom + 1) * row);
      data.set(scratch, bottom * row);
    }
    return { width, height, data };
  }

  /** Called after the context came back and was rebuilt. Returns a function that removes the listener. */
  onContextRestored(listener: () => void): () => void {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
  }

  /** Releases every GL object and decoded image and stops listening; a pending `setScene` is superseded. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.builder.dispose();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseScene();
    if (this.gpu && !this.lost) this.releaseGpu(this.gpu);
    this.gpu = null;
    this.restoredListeners.clear();
  }

  /** Packs the edge texels again when the sharp angle changed since they were packed; before any upload of them. */
  private repackEdges(loaded: LoadedScene): void {
    if (loaded.edgeAngle === this.edges.sharpAngleDeg) return;
    const flat = flatEdges(loaded.doc, loaded.sources, this.sharpEdgeOptions());
    packTriangleEdges(loaded.geometry.triAttributes, flat, loaded.order, loaded.geometry.triangleCount);
    loaded.edgeAngle = this.edges.sharpAngleDeg;
  }

  private sharpEdgeOptions(): { sharpAngleDeg: number; reach: number } {
    return { sharpAngleDeg: this.edges.sharpAngleDeg, reach: MAX_EDGE_WIDTH };
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.disposed;
  }

  private queryCapabilities(): PathTracerCapabilities {
    const gl = this.gl;
    const maxTextureSize = positiveInt(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2048);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    return {
      maxTextureSize,
      maxArrayTextureLayers: positiveInt(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), 256),
      layerSide: Math.min(maxTextureSize, DEFAULT_MAX_TEXTURE_SIDE),
      renderer: String(renderer),
    };
  }

  private textureLimits(capabilities: PathTracerCapabilities): TextureLimits {
    return {
      maxTextureSide: Math.min(this.options.maxTextureSide ?? DEFAULT_MAX_TEXTURE_SIDE, capabilities.layerSide),
      maxTexturePixelsTotal: this.options.maxTexturePixelsTotal ?? DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
    };
  }

  private createGpu(): Gpu {
    const gl = this.gl;
    requireExactAccumulation(gl);
    const capabilities = this.queryCapabilities();
    const programs = new TracerPrograms(gl);
    return {
      capabilities,
      programs,
      vao: gl.createVertexArray(),
      scene: null,
      targets: null,
      resolve: null,
      targetLimits: this.queryTargetLimits(capabilities),
    };
  }

  /** The largest render target on each axis, from the context's `Gpu` (queried once) or queried now without one. */
  private targetLimits(): TargetLimits {
    return this.gpu?.targetLimits ?? this.queryTargetLimits(this.capabilities ?? this.queryCapabilities());
  }

  /** The largest render target side on each axis: min of MAX_TEXTURE_SIZE, MAX_RENDERBUFFER_SIZE, MAX_VIEWPORT_DIMS. */
  private queryTargetLimits(capabilities: PathTracerCapabilities): TargetLimits {
    const gl = this.gl;
    const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const dims = viewport instanceof Int32Array ? viewport : new Int32Array([4096, 4096]);
    const maxRenderbuffer = positiveInt(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 2048);
    return {
      maxWidth: Math.min(positiveInt(dims[0], 2048), maxRenderbuffer, capabilities.maxTextureSize),
      maxHeight: Math.min(positiveInt(dims[1], 2048), maxRenderbuffer, capabilities.maxTextureSize),
    };
  }

  /** The supersampling scale of the current request on this canvas, within the target limits. */
  private updateScale(): void {
    const requested = this.quality.supersample;
    this.scale =
      requested === 1 ? 1 : supersampledScale(requested, this.canvas.width, this.canvas.height, this.targetLimits());
  }

  private uploadLoaded(gpu: Gpu): void {
    const loaded = this.loaded;
    if (!loaded) return;
    gpu.scene = uploadGpuScene(this.gl, loaded.geometry, loaded.materials, loaded.plan, loaded.images);
  }

  /**
   * The accumulation at the request's scale (with moments for denoise or a threshold) and the quality path's targets,
   * each allocated only when needed; anything new restarts at sample 0.
   */
  private ensureTargets(gpu: Gpu): AccumulationTargets {
    const scale = this.scale;
    const width = this.canvas.width * scale;
    const height = this.canvas.height * scale;
    const { denoise, noiseThreshold } = this.quality;
    const moments = denoise || noiseThreshold !== null;
    const transparent = this.transparent;
    // The programs first: a shader failure throws before any target is made, freed or cleared.
    const programs: QualityProgramName[] = [];
    if (denoise) programs.push('guide', 'denoise');
    if (scale > 1 || denoise) programs.push('resolve');
    if (moments) programs.push('noise');
    gpu.programs.require(programs);
    let targets = gpu.targets;
    if (
      !targets ||
      targets.width !== width ||
      targets.height !== height ||
      targets.moments !== moments ||
      targets.transparent !== transparent
    ) {
      targets?.dispose();
      gpu.targets = null;
      targets = new AccumulationTargets(this.gl, width, height, moments, transparent);
      gpu.targets = targets;
      this.resetAccumulation();
    }
    const layout: ResolveLayout = {
      width,
      height,
      outputWidth: this.canvas.width,
      outputHeight: this.canvas.height,
      denoise,
      resolve: scale > 1 || denoise,
      noise: moments,
      transparent,
    };
    if (!layout.resolve && !layout.noise) {
      gpu.resolve?.dispose();
      gpu.resolve = null;
    } else if (!gpu.resolve?.matches(layout)) {
      gpu.resolve?.dispose();
      gpu.resolve = null;
      gpu.resolve = new ResolveTargets(this.gl, layout);
      this.resetAccumulation();
      targets.clear();
    }
    return targets;
  }

  /** Back to sample 0 of the current request (scene, camera or size changed, or a new request). */
  private restart(): void {
    this.resetAccumulation();
    if (this.gpu?.targets && !this.lost) this.gpu.targets.clear();
  }

  private resetAccumulation(): void {
    this.done = 0;
    this.guided = false;
    this.noise = null;
    this.noiseSamples = 0;
    this.converged = false;
    this.startedAt = null;
    this.lastStepAt = 0;
  }

  private drawTiles(tiles: readonly Tile[]): void {
    const gl = this.gl;
    gl.enable(gl.SCISSOR_TEST);
    for (const tile of tiles) {
      gl.scissor(tile.x, tile.y, tile.width, tile.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Unbinds 2D textures from units 0..count − 1 and leaves unit 0 active. */
  private unbindTextures(count: number): void {
    const gl = this.gl;
    for (let unit = count - 1; unit >= 0; unit--) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private bindTrace(gpu: Gpu, camera: CameraUniforms, seed: number, targets: AccumulationTargets): void {
    const gl = this.gl;
    const { uniform } = gpu.programs.trace;
    this.bindScene(gpu, gpu.programs.trace, camera, seed, targets);
    gl.uniform1i(uniform('u_previous'), UNIT_SUM);
    gl.uniform1i(uniform('u_previousMoments'), UNIT_MOMENTS);
    gl.uniform1i(uniform('u_moments'), targets.moments ? 1 : 0);
    gl.uniform1i(uniform('u_previousCoverage'), UNIT_COVERAGE);
    gl.uniform1i(uniform('u_transparent'), targets.transparent ? 1 : 0);
    gl.uniform1i(uniform('u_maxBounces'), this.maxBounces);
  }

  /**
   * Uses `traced` (the trace or the guide) with the scene data on units 1..5 and the camera, look, edge and catcher
   * uniforms, the frame being the accumulation's size.
   */
  private bindScene(
    gpu: Gpu,
    traced: TracerProgram,
    camera: CameraUniforms,
    seed: number,
    frame: { readonly width: number; readonly height: number },
  ): void {
    const gl = this.gl;
    const { program, uniform } = traced;
    const scene = gpu.scene ?? this.emptyScene(gpu);
    gl.useProgram(program);
    gl.viewport(0, 0, frame.width, frame.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(gpu.vao);
    const textures: [string, number, WebGLTexture][] = [
      ['u_nodes', gl.TEXTURE_2D, scene.nodes],
      ['u_triPositions', gl.TEXTURE_2D, scene.triPositions],
      ['u_triAttributes', gl.TEXTURE_2D, scene.triAttributes],
      ['u_materials', gl.TEXTURE_2D, scene.materials],
      ['u_textureLayers', gl.TEXTURE_2D_ARRAY, scene.layers],
    ];
    textures.forEach(([name, target, texture], i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(target, texture);
      gl.uniform1i(uniform(name), 1 + i);
    });
    gl.uniform1i(uniform('u_dataWidth'), DATA_TEXTURE_WIDTH);
    gl.uniform1i(uniform('u_nodeCount'), scene.nodeCount);
    gl.uniform1f(uniform('u_maxRenderOrder'), scene.maxRenderOrder);
    gl.uniform1f(uniform('u_orderTie'), RENDER_ORDER_TIE_DISTANCE);
    gl.uniform1f(uniform('u_backSideOrder'), BACK_SIDE_RENDER_ORDER);
    gl.uniform1i(uniform('u_orthographic'), camera.orthographic ? 1 : 0);
    gl.uniform3fv(uniform('u_cameraPosition'), camera.position);
    gl.uniform3fv(uniform('u_cameraForward'), camera.forward);
    gl.uniform3fv(uniform('u_cameraRight'), camera.right);
    gl.uniform3fv(uniform('u_cameraUp'), camera.up);
    gl.uniform2fv(uniform('u_cameraScale'), camera.scale);
    gl.uniform1f(uniform('u_near'), camera.near);
    gl.uniform1f(uniform('u_far'), camera.far);
    // The traced frame: a supersampled one spans the same view, its backdrop gradient its full height.
    gl.uniform2f(uniform('u_viewportSize'), frame.width, frame.height);
    gl.uniform1ui(uniform('u_seed'), seed);
    uploadLookUniforms(gl, uniform, this.lookPreset, frame.height, lookView(camera));
    gl.uniform1f(uniform('u_edgeWidth'), this.edges.width);
    const catcher = this.loaded?.catcher ?? null;
    gl.uniform1i(uniform('u_catcherOn'), catcher ? 1 : 0);
    gl.uniform1f(uniform('u_catcherY'), catcher?.y ?? 0);
    gl.uniform4fv(uniform('u_catcherRect'), catcher?.rect ?? [0, 0, 0, 0]);
  }

  /** Data for a tracer without a scene: no nodes, so every camera ray shows the backdrop. */
  private emptyScene(gpu: Gpu): GpuScene {
    const flat = flattenScene(EMPTY_SCENE, 0);
    const layout = layoutTextures([], gpu.capabilities.layerSide, gpu.capabilities.maxArrayTextureLayers);
    gpu.scene = uploadGpuScene(
      this.gl,
      packGeometry(flat, buildBvh(flat.positions, 0), gpu.capabilities.maxTextureSize),
      packMaterials(EMPTY_SCENE, layout.textures),
      layout.plan,
      layout.images,
    );
    return gpu.scene;
  }

  /** The noise estimate of the samples so far: per block on the GPU, its quantile on the CPU. */
  private measureNoise(gpu: Gpu, targets: AccumulationTargets, extra: ResolveTargets): void {
    const gl = this.gl;
    const noise = extra.noise;
    if (!noise) return;
    const { program, uniform } = gpu.programs.get('noise');
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, noise.framebuffer);
    gl.viewport(0, 0, extra.noiseWidth, extra.noiseHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.sum.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targets.sum.moments);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, targets.sum.coverage);
    gl.uniform1i(uniform('u_sum'), 0);
    gl.uniform1i(uniform('u_moments'), 1);
    gl.uniform1i(uniform('u_coverage'), 2);
    gl.uniform1i(uniform('u_transparent'), targets.transparent ? 1 : 0);
    gl.uniform1f(uniform('u_samples'), this.done);
    gl.uniform1i(uniform('u_scale'), targets.width / this.canvas.width);
    gl.uniform2i(uniform('u_outputSize'), this.canvas.width, this.canvas.height);
    gl.bindVertexArray(gpu.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.unbindTextures(3);
    const blocks = extra.readNoise();
    // A lost context reads zeros, which would pass any threshold.
    if (gl.isContextLost()) return;
    this.noise = noiseQuantile(blocks);
    this.noiseSamples = this.done;
  }

  /**
   * The canvas-size linear image of the samples so far into `extra.resolved`: denoised (DENOISE_ITERATIONS filter
   * passes over the traced frame, tiled like the trace) or not, then box-downsampled. A function of the sums and the
   * guides alone.
   */
  private resolveImage(gpu: Gpu, targets: AccumulationTargets, extra: ResolveTargets, tiles: readonly Tile[]): void {
    const gl = this.gl;
    const resolved = extra.resolved;
    if (!resolved) return;
    gl.bindVertexArray(gpu.vao);
    let source = targets.sum.texture;
    let filteredCoverage: WebGLTexture | null = null;
    const denoised = extra.guide !== null && extra.filtered !== null;
    if (extra.guide && extra.filtered) {
      const { program, uniform } = gpu.programs.get('denoise');
      gl.useProgram(program);
      gl.viewport(0, 0, targets.width, targets.height);
      const inputs: [string, WebGLTexture | null][] = [
        ['u_sum', targets.sum.texture],
        ['u_moments', targets.sum.moments],
        ['u_albedo', extra.guide.albedo],
        ['u_normal', extra.guide.normal],
        ['u_coverageSum', targets.sum.coverage],
      ];
      inputs.forEach(([name, texture], unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniform(name), unit);
      });
      const sourceUnit = inputs.length;
      const coverageSourceUnit = sourceUnit + 1;
      gl.uniform1i(uniform('u_source'), sourceUnit);
      gl.uniform1i(uniform('u_coverageSource'), coverageSourceUnit);
      gl.uniform1i(uniform('u_transparent'), targets.transparent ? 1 : 0);
      gl.uniform1f(uniform('u_samples'), this.done);
      for (let i = 0; i < DENOISE_ITERATIONS; i++) {
        const output = extra.filtered[i % 2] as (typeof extra.filtered)[0];
        // Never the texture being written: the first pass reads the accumulation instead.
        gl.activeTexture(gl.TEXTURE0 + sourceUnit);
        gl.bindTexture(gl.TEXTURE_2D, i === 0 ? null : (extra.filtered[(i + 1) % 2]?.texture ?? null));
        gl.activeTexture(gl.TEXTURE0 + coverageSourceUnit);
        gl.bindTexture(gl.TEXTURE_2D, i === 0 ? null : (extra.filtered[(i + 1) % 2]?.coverage ?? null));
        gl.uniform1i(uniform('u_first'), i === 0 ? 1 : 0);
        gl.uniform1i(uniform('u_step'), 1 << i);
        gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
        this.drawTiles(tiles);
        source = output.texture;
        filteredCoverage = output.coverage;
      }
      this.unbindTextures(coverageSourceUnit + 1);
    }
    const { program, uniform } = gpu.programs.get('resolve');
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolved.framebuffer);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, extra.guide?.albedo ?? null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, targets.sum.coverage);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, filteredCoverage);
    gl.uniform1i(uniform('u_source'), 0);
    gl.uniform1i(uniform('u_albedo'), 1);
    gl.uniform1i(uniform('u_coverage'), 2);
    gl.uniform1i(uniform('u_filteredCoverage'), 3);
    gl.uniform1i(uniform('u_coverageFiltered'), filteredCoverage ? 1 : 0);
    gl.uniform1i(uniform('u_transparent'), targets.transparent ? 1 : 0);
    gl.uniform1i(uniform('u_denoised'), denoised ? 1 : 0);
    gl.uniform1f(uniform('u_samples'), this.done);
    gl.uniform1i(uniform('u_scale'), targets.width / this.canvas.width);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.unbindTextures(4);
  }

  /**
   * The mean so far, or on the quality path the image resolved at the latest checkpoint, through AgX: to the canvas,
   * or with straight alpha into `readback` (`readImage`).
   */
  private present(gpu: Gpu, readback: WebGLFramebuffer | null = null): void {
    const gl = this.gl;
    const { program, uniform } = gpu.programs.present;
    const resolved = this.done > 0 ? gpu.resolve?.resolved : undefined;
    const targets = gpu.targets;
    gl.bindFramebuffer(gl.FRAMEBUFFER, readback);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, resolved ? null : (targets?.sum.coverage ?? null));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resolved?.texture ?? targets?.sum.texture ?? null);
    gl.uniform1i(uniform('u_sum'), 0);
    gl.uniform1i(uniform('u_coverage'), 1);
    gl.uniform1i(uniform('u_transparent'), targets?.transparent ? 1 : 0);
    gl.uniform1i(uniform('u_coverageInSum'), resolved ? 1 : 0);
    gl.uniform1i(uniform('u_readback'), readback ? 1 : 0);
    gl.uniform1f(uniform('u_samples'), resolved ? 1 : targets ? this.done : 0);
    // Backdrop and tone mapping only: no rim, so no camera.
    uploadLookUniforms(gl, uniform, this.lookPreset, this.canvas.height, LOOK_VIEW_NONE);
    gl.bindVertexArray(gpu.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.unbindTextures(2);
  }

  /**
   * Drops the shown scene. With `next` (the scene replacing it) the textures `keep` holds stay and the images `next`
   * shares with it stay open.
   */
  private releaseScene(next?: LoadedScene, keep?: GpuScene | null): void {
    const gpu = this.gpu;
    if (gpu?.scene && !this.lost) disposeGpuScene(this.gl, gpu.scene, keep);
    if (gpu) gpu.scene = null;
    if (this.loaded && this.loaded.bitmaps !== next?.bitmaps) {
      for (const bitmap of this.loaded.bitmaps) bitmap?.close();
    }
    this.loaded = null;
  }

  private releaseGpu(gpu: Gpu): void {
    const gl = this.gl;
    if (gpu.scene) disposeGpuScene(gl, gpu.scene);
    gpu.targets?.dispose();
    gpu.resolve?.dispose();
    gpu.programs.dispose();
    gl.deleteVertexArray(gpu.vao);
  }

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    this.lost = true;
    this.contextEpoch++;
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.lost = false;
    // The old handles died with the context; nothing to delete.
    this.gpu = null;
    try {
      this.gpu = this.createGpu();
      this.uploadLoaded(this.gpu);
      this.updateScale();
    } catch {
      this.gpu = null;
      return;
    }
    this.resetAccumulation();
    for (const listener of [...this.restoredListeners]) listener();
  };
}
