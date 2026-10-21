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
  sceneBounds,
  type SceneCamera,
  type SceneDocument,
} from '@modelshot/scene';
import { LIGHT_RIG_V0, MAX_EDGE_WIDTH, checkEdgeLook, type EdgeLook } from '@modelshot/looks';
import { AccumulationTargets } from './accumulationTargets';
import { buildBvh } from './buildBvh';
import { cameraUniforms, type CameraUniforms } from './cameraUniforms';
import { flatEdges, flattenScene, DEFAULT_MAX_TRIANGLES } from './flattenScene';
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
import type { PathTracerOptions, RenderRequest, SetSceneOptions, SetSceneResult } from './PathTracerOptions';
import type { PathTracerWarning } from './PathTracerWarning';
import { sampleTiles, samplesToDraw } from './sampleSchedule';
import { requireExactAccumulation } from './requireExactAccumulation';
import { layoutTextures } from './layoutTextures';
import type { TextureLayerPlan } from './textureLayers';
import { createTracerPrograms, disposeTracerPrograms, type TracerPrograms } from './tracerPrograms';

const DEFAULT_MAX_BOUNCES = 4;
const MAX_BOUNCES = 16;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_MAX_TEXTURE_SIDE = 4096;
export const MAX_SAMPLES = 65536;
export const MAX_SEED = 2 ** 32 - 1;

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
  readonly plan: TextureLayerPlan;
  readonly images: readonly (ImageBitmap | RawImage)[];
  readonly bitmaps: readonly (ImageBitmap | null)[];
  /** The shadow catcher camera rays see, `null` when `SetSceneOptions.shadowCatcher` is false. */
  readonly catcher: ShadowCatcherPlane | null;
}

interface Gpu {
  readonly capabilities: PathTracerCapabilities;
  readonly programs: TracerPrograms;
  readonly vao: WebGLVertexArrayObject;
  scene: GpuScene | null;
  targets: AccumulationTargets | null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
  private done = 0;
  private cancelled = false;
  private generation = 0;
  private lost = false;
  private disposed = false;
  private readonly restoredListeners = new Set<() => void>();
  private readonly background: readonly [number, number, number];
  private readonly maxBounces: number;
  private readonly tileSize: number;
  private edges: EdgeLook;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly options: PathTracerOptions,
  ) {
    this.background = options.background ?? LIGHT_RIG_V0.background;
    this.maxBounces = checkInteger('maxBounces', options.maxBounces ?? DEFAULT_MAX_BOUNCES, 1, MAX_BOUNCES);
    this.tileSize = checkInteger('tileSize', options.tileSize ?? DEFAULT_TILE_SIZE, 16, 4096);
    this.edges = checkEdgeLook(options.edges);
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
   * or `HIGHP_UNAVAILABLE` (no exact accumulation here; the preview still works) or a shader error, and a
   * `RangeError` for an option out of range.
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

  get contextLost(): boolean {
    return this.lost;
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

  /** `step()` would draw more: a request is running, not cancelled and not complete. */
  get running(): boolean {
    return this.request !== null && !this.cancelled && this.done < this.request.samples;
  }

  /**
   * Validates `doc` (`PathTracerError` `INVALID_SCENE`), checks its material count and flattens its visible triangles
   * (`SCENE_TOO_LARGE` before any vertex is read or array allocated), builds the BVH and packs the data
   * (`SCENE_TOO_LARGE` for rows over MAX_TEXTURE_SIZE before the arrays are allocated), all before the first `await`;
   * then decodes the textures, lays them out (`SCENE_TOO_LARGE` over MAX_ARRAY_TEXTURE_LAYERS, the decoded images
   * closed) and swaps the scene in; the accumulation restarts at sample 0. Nothing reaches the GPU before every check
   * passed, and a failing call keeps the current scene. A later call that passes the synchronous checks, or
   * `dispose()`, supersedes a pending one: it resolves with `applied: false` and closes what it decoded. A later call
   * rejected by the synchronous checks supersedes nothing.
   */
  async setScene(doc: SceneDocument, options: SetSceneOptions = {}): Promise<SetSceneResult> {
    if (this.disposed) return { applied: false, warnings: [], triangles: 0 };
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
    const packedAngle = this.edges.sharpAngleDeg;
    const flat = flattenScene(doc, this.options.maxTriangles ?? DEFAULT_MAX_TRIANGLES, this.sharpEdgeOptions());
    const bvh = buildBvh(flat.positions, flat.count);
    const geometry = packGeometry(flat, bvh, capabilities.maxTextureSize);
    // The catcher's height and rectangle do not depend on its texel size, which only the light bake needs.
    const catcher =
      options.shadowCatcher === false ? null : shadowCatcherPlane(sceneBounds(doc), LIGHT_RIG_V0.keyDirection, 1);
    // Only a scene that passed every limit supersedes a pending one.
    const generation = ++this.generation;
    const decoded = await decodeTextures(doc.textures, this.textureLimits(capabilities), () =>
      this.isCurrent(generation),
    );
    if (!decoded) return { applied: false, warnings: [], triangles: 0 };
    // Everything that can still fail runs before the current scene is released: a failure keeps it and closes the
    // images this call decoded.
    let loaded: LoadedScene;
    try {
      const layout = layoutTextures(decoded.bitmaps, capabilities.layerSide, capabilities.maxArrayTextureLayers);
      loaded = {
        doc,
        sources: flat.sources,
        edgeAngle: packedAngle,
        order: bvh.order,
        geometry,
        materials: packMaterials(doc, layout.textures, options.emission),
        plan: layout.plan,
        images: layout.images,
        bitmaps: decoded.bitmaps,
        catcher,
      };
    } catch (error) {
      for (const bitmap of decoded.bitmaps) bitmap?.close();
      throw error;
    }
    this.releaseScene();
    this.loaded = loaded;
    this.repackEdges(loaded);
    if (this.gpu && !this.lost) this.uploadLoaded(this.gpu);
    this.restart();
    const warnings: PathTracerWarning[] = [];
    if (flat.skipped > 0) {
      warnings.push({
        code: 'DEGENERATE_TRIANGLES',
        count: flat.skipped,
        message: `${flat.skipped} triangles skipped: a position, normal or UV is not finite, or the triangle has no area`,
      });
    }
    for (const warning of decoded.warnings) warnings.push({ ...warning });
    return { applied: true, warnings, triangles: flat.count };
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
    const capabilities = this.capabilities ?? this.queryCapabilities();
    const gl = this.gl;
    const viewport: unknown = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const dims = viewport instanceof Int32Array ? viewport : new Int32Array([4096, 4096]);
    const maxRenderbuffer = positiveInt(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 2048);
    const result = canvasSize(size, {
      maxWidth: Math.min(positiveInt(dims[0], 2048), maxRenderbuffer, capabilities.maxTextureSize),
      maxHeight: Math.min(positiveInt(dims[1], 2048), maxRenderbuffer, capabilities.maxTextureSize),
      ...(this.options.maxPixels !== undefined ? { maxPixels: this.options.maxPixels } : {}),
    });
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
      this.restart();
    }
    return result;
  }

  /**
   * Starts a render of exactly `samples` samples per pixel from `seed`, discarding what was accumulated. `seed` must be
   * an integer in 0..2^32 − 1 and `samples` in 1..65536, else `RangeError`.
   */
  start(request: RenderRequest): void {
    const seed = checkInteger('seed', request.seed, 0, MAX_SEED);
    const samples = checkInteger('samples', request.samples, 1, MAX_SAMPLES);
    this.request = { seed, samples };
    this.cancelled = false;
    this.restart();
  }

  /**
   * Draws up to `maxSamples` more samples of the current request (never past its count), presents the mean and
   * returns how many it drew. A no-op returning 0 without a camera, when complete, cancelled, while the context is lost
   * or after `dispose()`.
   */
  step(maxSamples = 1): number {
    const gpu = this.gpu;
    const request = this.request;
    if (!gpu || !request || !this.camera || this.cancelled || this.lost || this.disposed || this.gl.isContextLost()) {
      return 0;
    }
    const count = samplesToDraw(this.done, request.samples, maxSamples);
    if (count === 0) return 0;
    const targets = this.ensureTargets(gpu);
    const camera = cameraUniforms(this.camera, this.canvas.width / this.canvas.height);
    this.bindTrace(gpu, camera, request.seed);
    const gl = this.gl;
    const trace = gpu.programs.trace;
    const tiles = sampleTiles(targets.width, targets.height, this.tileSize);
    gl.enable(gl.SCISSOR_TEST);
    for (let i = 0; i < count; i++) {
      gl.uniform1ui(trace.uniform('u_sample'), this.done);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.next.framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets.sum.texture);
      for (const tile of tiles) {
        gl.scissor(tile.x, tile.y, tile.width, tile.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      targets.swap();
      this.done++;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.present(gpu);
    return count;
  }

  /** Stops the current request: `step()` draws nothing more until `start`; the image of the samples done stays. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * The per-pixel float sums of the samples done (rows bottom to top): rgb the radiance (divide by `samplesDone`), a
   * the traversals stopped by the per-ray node cap (0 in any ordinary scene). For a denoiser or a test; `null` while
   * the context is lost or before a sample.
   */
  readAccumulation(): Float32Array | null {
    const targets = this.gpu?.targets;
    if (!targets || this.lost || this.done === 0) return null;
    return targets.read();
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
    const programs = createTracerPrograms(gl);
    return { capabilities, programs, vao: gl.createVertexArray(), scene: null, targets: null };
  }

  private uploadLoaded(gpu: Gpu): void {
    const loaded = this.loaded;
    if (!loaded) return;
    gpu.scene = uploadGpuScene(this.gl, loaded.geometry, loaded.materials, loaded.plan, loaded.images);
  }

  private ensureTargets(gpu: Gpu): AccumulationTargets {
    const { width, height } = this.canvas;
    if (gpu.targets && gpu.targets.width === width && gpu.targets.height === height) return gpu.targets;
    gpu.targets?.dispose();
    gpu.targets = null;
    gpu.targets = new AccumulationTargets(this.gl, width, height);
    this.done = 0;
    return gpu.targets;
  }

  /** Back to sample 0 of the current request (scene, camera or size changed, or a new request). */
  private restart(): void {
    this.done = 0;
    if (this.gpu?.targets && !this.lost) this.gpu.targets.clear();
  }

  private bindTrace(gpu: Gpu, camera: CameraUniforms, seed: number): void {
    const gl = this.gl;
    const { program, uniform } = gpu.programs.trace;
    const scene = gpu.scene ?? this.emptyScene(gpu);
    gl.useProgram(program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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
    gl.uniform1i(uniform('u_previous'), 0);
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
    gl.uniform2f(uniform('u_viewportSize'), this.canvas.width, this.canvas.height);
    gl.uniform1ui(uniform('u_seed'), seed);
    gl.uniform1i(uniform('u_maxBounces'), this.maxBounces);
    gl.uniform3fv(uniform('u_background'), this.background);
    gl.uniform1f(uniform('u_edgeWidth'), this.edges.width);
    const catcher = this.loaded?.catcher ?? null;
    gl.uniform1i(uniform('u_catcherOn'), catcher ? 1 : 0);
    gl.uniform1f(uniform('u_catcherY'), catcher?.y ?? 0);
    gl.uniform4fv(uniform('u_catcherRect'), catcher?.rect ?? [0, 0, 0, 0]);
  }

  /** Data for a tracer without a scene: no nodes, so every camera ray shows the background. */
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

  private present(gpu: Gpu): void {
    const gl = this.gl;
    const { program, uniform } = gpu.programs.present;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.targets?.sum.texture ?? null);
    gl.uniform1i(uniform('u_sum'), 0);
    gl.uniform1f(uniform('u_samples'), gpu.targets ? this.done : 0);
    gl.uniform3fv(uniform('u_background'), this.background);
    gl.bindVertexArray(gpu.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private releaseScene(): void {
    const gpu = this.gpu;
    if (gpu?.scene && !this.lost) disposeGpuScene(this.gl, gpu.scene);
    if (gpu) gpu.scene = null;
    for (const bitmap of this.loaded?.bitmaps ?? []) bitmap?.close();
    this.loaded = null;
  }

  private releaseGpu(gpu: Gpu): void {
    const gl = this.gl;
    if (gpu.scene) disposeGpuScene(gl, gpu.scene);
    gpu.targets?.dispose();
    disposeTracerPrograms(gl, gpu.programs);
    gl.deleteVertexArray(gpu.vao);
  }

  private readonly handleContextLost = (event: Event): void => {
    // Without preventDefault the browser never restores the context.
    event.preventDefault();
    this.lost = true;
  };

  private readonly handleContextRestored = (): void => {
    if (this.disposed) return;
    this.lost = false;
    // The old handles died with the context; nothing to delete.
    this.gpu = null;
    try {
      this.gpu = this.createGpu();
      this.uploadLoaded(this.gpu);
    } catch {
      this.gpu = null;
      return;
    }
    this.done = 0;
    for (const listener of [...this.restoredListeners]) listener();
  };
}
