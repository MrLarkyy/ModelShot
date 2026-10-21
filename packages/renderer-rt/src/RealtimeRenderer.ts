import {
  BACK_SIDE_RENDER_ORDER,
  RENDER_ORDER_TIE_DISTANCE,
  cachedSharpEdges,
  cameraProjection,
  cameraView,
  mat4Multiply,
  meshVisible,
  nodeVisibility,
  type Mat4,
  type SceneCamera,
  type SceneDocument,
  type SharpEdgeAttributes,
} from '@modelshot/scene';
import { LIGHT_RIG_V0, MAX_EDGE_WIDTH, checkEdgeLook, type EdgeLook } from '@modelshot/looks';
import type { BakedLighting } from './BakedLighting';
import { checkLighting } from './checkLighting';
import { canvasSize, type CanvasCssSize, type CanvasSize } from './canvasSize';
import { DEFAULT_MAX_TEXTURE_PIXELS_TOTAL, decodeTextures, type TextureLimits } from './decodeTextures';
import { queryGlLimits, type GlLimits } from './glLimits';
import { depthKeyMode, depthPull, exactDepthRange, type DepthKeyMode } from './depthKeyMode';
import { invertMat4 } from './invertMat4';
import { lightmapLayout, type LightmapLayoutSummary } from './lightmapLayout';
import { poseOnlyChange } from './poseOnlyChange';
import { uploadBands } from './uploadBands';
import { createRendererPrograms, type MeshPassName, type RendererPrograms } from './rendererPrograms';
import { RendererError } from './RendererError';
import type { RendererWarning } from './RendererWarning';
import { RenderTargets } from './RenderTargets';
import { backSidesVisible, closedOpaqueMeshes } from './closedOpaque';
import {
  PLACEHOLDER_IMAGE,
  UNTEXTURED_IMAGE,
  readTextureAlpha,
  uploadTexture,
  type AlphaLevels,
} from './textureUpload';
import { disposeGpuScene, uploadExactGeometry, uploadScene, type DrawItem, type GpuScene } from './uploadScene';
import { validateScene } from './validateScene';

export interface RendererOptions {
  /** Use the no-float path even when float render targets exist (tests, diagnostics). */
  readonly forceFallback?: boolean;
  /** Texel anti-aliasing; `false` samples plain nearest texels. Default `true`. */
  readonly texelAntialias?: boolean;
  /** Scene-linear backdrop colour behind the model. */
  readonly background?: readonly [number, number, number];
  /** Largest texture side accepted (further capped by MAX_TEXTURE_SIZE). Default 4096. */
  readonly maxTextureSide?: number;
  /** Total decoded texture pixels per scene. Default 64 Mi. */
  readonly maxTexturePixelsTotal?: number;
  /** Cap on the backing store's width × height. */
  readonly maxPixels?: number;
  /** Upper bound on MSAA samples of the float path. Default 4. */
  readonly maxMsaaSamples?: number;
  /** Keep the drawn image readable after the frame (screenshots, tests). Default `false`. */
  readonly preserveDrawingBuffer?: boolean;
  /**
   * Rounded sharp edges, the path tracer's (`PathTracerOptions.edges`): fields left out take `EDGE_LOOK_V0`. A value
   * out of range throws a `RangeError` naming `edges.width` or `edges.sharpAngleDeg`.
   */
  readonly edges?: Partial<EdgeLook>;
}

export interface RendererCapabilities {
  /** `float`: MSAA HDR targets, weighted blended OIT, AgX on present. `fallback`: no EXT_color_buffer_float. */
  readonly path: 'float' | 'fallback';
  readonly msaaSamples: number;
  readonly limits: GlLimits;
}

export interface SetSceneResult {
  /** `false` when a later `setScene` or `dispose` superseded this call; nothing of it was kept. */
  readonly applied: boolean;
  readonly warnings: readonly RendererWarning[];
}

const DEFAULT_MAX_TEXTURE_SIDE = 4096;
const DEFAULT_MSAA_SAMPLES = 4;
/** The float path's depth renderbuffers are DEPTH_COMPONENT24 (RenderTargets). */
const FLOAT_PATH_DEPTH_BITS = 24;

interface LoadedScene {
  readonly doc: SceneDocument;
  /** Decoded images, kept so a lost context can be rebuilt without decoding again. */
  readonly bitmaps: readonly (ImageBitmap | null)[];
  /** Per texture: the alpha bytes it holds, read back once and kept CPU-side. */
  alphaLevels: (AlphaLevels | null)[] | null;
  /** Per mesh: closed and opaque on every face (`closedOpaqueMeshes`), from the same readback. */
  closedOpaque: boolean[] | null;
  /** Where baked light lies (`lightmapLayout`); `setLighting` takes only lighting baked for it. */
  readonly layout: LightmapLayoutSummary;
}

/** The baked light on the GPU: RGBA16F lightmaps and the shadow catcher's quad. */
interface GpuLighting {
  /** The lighting the textures hold. */
  source: BakedLighting;
  readonly lightmap: WebGLTexture;
  readonly catcher: {
    readonly texture: WebGLTexture;
    readonly vao: WebGLVertexArrayObject;
    readonly buffer: WebGLBuffer;
  } | null;
}

/** Lighting being written band by band into textures that are not drawn yet. */
interface LightingUpload {
  readonly target: GpuLighting;
  readonly lighting: BakedLighting;
  lightmapRow: number;
  catcherRow: number;
}

/** What one frame draws with: matrices, the far plane and the depth-key variant (`depthKeyMode`). */
interface FrameView {
  readonly view: Float32Array;
  readonly projection: Mat4;
  readonly inverseProjection: Float32Array;
  readonly viewProjection: Float32Array;
  readonly far: number;
  /** Camera position and near distance: whether a closed opaque batch's back sides can show (`backSidesVisible`). */
  readonly eye: readonly [number, number, number];
  readonly near: number;
  readonly mode: DepthKeyMode;
  /** Viewport of every mesh pass (the float targets and the fallback both draw at the canvas size). */
  readonly viewport: readonly [number, number];
}

interface GpuResources {
  programs: RendererPrograms;
  targets: RenderTargets | null;
  readonly fullscreenVao: WebGLVertexArrayObject;
  readonly placeholder: WebGLTexture;
  readonly untextured: WebGLTexture;
  capabilities: RendererCapabilities;
  sceneTextures: (WebGLTexture | null)[];
  scene: GpuScene | null;
  /** 1 × 1 light of value 1, bound while there is no baked light. */
  readonly unbakedLight: WebGLTexture;
  /** The baked light frames draw with. */
  lighting: GpuLighting | null;
  /** The next lighting, still uploading; frames keep the complete one until it is done. */
  upload: LightingUpload | null;
  /** The previous textures, kept for the next upload of the same shape. */
  spare: GpuLighting | null;
}

/**
 * WebGL2 realtime preview of a `SceneDocument`. Draws only when `render()` is called (no clock, no animation loop);
 * `needsRender` tells a caller's loop whether anything changed. Survives context loss: drawing pauses, and on restore
 * every GPU resource is rebuilt from the retained scene and decoded images.
 */
export class RealtimeRenderer {
  private gpu: GpuResources | null = null;
  private loaded: LoadedScene | null = null;
  private camera: SceneCamera | null = null;
  private generation = 0;
  private lost = false;
  private disposed = false;
  private dirty = true;
  private frameDepthKey: DepthKeyMode | null = null;
  /** Kept on the CPU so a lost context gets it back. */
  private lighting: BakedLighting | null = null;
  private readonly restoredListeners = new Set<() => void>();
  private readonly background: readonly [number, number, number];
  private edges: EdgeLook;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly options: RendererOptions,
  ) {
    this.background = options.background ?? LIGHT_RIG_V0.background;
    this.edges = checkEdgeLook(options.edges);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    try {
      this.gpu = this.createGpuResources();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /**
   * Creates the WebGL2 context on `canvas`; throws `RendererError` `WEBGL2_UNAVAILABLE` or a shader error, and a
   * `RangeError` for `edges` out of range.
   */
  static create(canvas: HTMLCanvasElement, options: RendererOptions = {}): RealtimeRenderer {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new RendererError('WEBGL2_UNAVAILABLE', 'WebGL2 is not available in this browser');
    return new RealtimeRenderer(canvas, gl, options);
  }

  get capabilities(): RendererCapabilities | null {
    return this.gpu?.capabilities ?? null;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  /** Depth-key variant of the last drawn frame (`depthKeyMode`), `null` before a frame with a camera. */
  get depthKeyMode(): DepthKeyMode | null {
    return this.frameDepthKey;
  }

  /** Something changed since the last `render()`, or baked light is still uploading. */
  get needsRender(): boolean {
    return (this.dirty || this.gpu?.upload != null) && !this.lost && !this.disposed;
  }

  /** Baked light set by `setLighting` is still being uploaded; frames show the previous lighting until it is done. */
  get lightingPending(): boolean {
    return this.gpu?.upload != null && !this.lost && !this.disposed;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /**
   * Validates `doc` (a malformed one rejects with `RendererError` `INVALID_SCENE`) and lays out its lightmap
   * (`SCENE_TOO_LARGE` over its limit), decodes its textures off the drawing path and swaps it in. Baked light stays
   * when the new document has the same `layoutKey` (another pose of the same model) and is dropped otherwise. A later
   * call or `dispose()` supersedes a pending one: it resolves with `applied: false` and releases what it decoded.
   */
  async setScene(doc: SceneDocument): Promise<SetSceneResult> {
    if (this.disposed) return { applied: false, warnings: [] };
    validateScene(doc);
    // Another pose of the shown document keeps its layout: the layout never depends on the pose, and laying out a
    // large model again costs the main thread a hundred milliseconds or more.
    const layout =
      this.loaded && poseOnlyChange(this.loaded.doc, doc) ? this.loaded.layout : summarize(lightmapLayout(doc));
    const generation = ++this.generation;
    const decoded = await decodeTextures(doc.textures, this.textureLimits(), () => this.isCurrent(generation));
    if (!decoded) return { applied: false, warnings: [] };
    this.releaseScene();
    this.loaded = { doc, bitmaps: decoded.bitmaps, alphaLevels: null, closedOpaque: null, layout };
    if (this.lighting && this.lighting.layoutKey !== layout.layoutKey) this.dropLighting();
    if (this.gpu && !this.lost) this.uploadLoadedScene(this.gpu);
    this.dirty = true;
    return { applied: true, warnings: decoded.warnings };
  }

  /** The current scene's lightmap layout (what a bake for it must match); `null` before a scene. */
  get lightmapLayout(): LightmapLayoutSummary | null {
    return this.loaded?.layout ?? null;
  }

  /**
   * Shades the scene with baked light (`LightBaker` of `@modelshot/pathtracer`) and draws its shadow catcher, or
   * without (`null`): exactly the unbaked image. Returns `false` and changes nothing when the lighting was not baked
   * for the current scene's layout (`checkLighting`) or there is no scene. The upload is spread over the next
   * `render()` / `advanceLighting()` calls (`UPLOAD_FRAME_BYTES` each, in bands of `UPLOAD_BAND_BYTES`) into textures
   * frames do not draw yet; frames show the previous lighting until it is complete (`lightingPending`), then switch.
   */
  setLighting(lighting: BakedLighting | null): boolean {
    if (this.disposed) return false;
    if (lighting === null) {
      this.dropLighting();
      this.dirty = true;
      return true;
    }
    const layout = this.loaded?.layout;
    if (!layout || !checkLighting(layout, lighting)) return false;
    this.lighting = lighting;
    if (this.gpu && !this.lost) this.beginUpload(this.gpu, lighting);
    this.dirty = true;
    return true;
  }

  /**
   * Uploads the next part of pending baked light (at most `UPLOAD_FRAME_BYTES`), without drawing; `render()` calls it
   * too. Returns `true` while more remains. The main thread never hands the browser more than a band at once, so it
   * never waits for the GPU process, which may be busy with the bake's draws.
   */
  advanceLighting(): boolean {
    const gpu = this.gpu;
    const upload = gpu?.upload;
    if (!gpu || !upload || this.lost || this.disposed || this.gl.isContextLost()) return false;
    const gl = this.gl;
    const { lighting, target } = upload;
    const write = (texture: WebGLTexture, width: number, data: Uint16Array, row: number, rows: number): number => {
      const bands = uploadBands(rows, width * 8, row);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      for (const [start, count] of bands) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, start, width, count, gl.RGBA, gl.HALF_FLOAT, data, start * width * 4);
      }
      gl.bindTexture(gl.TEXTURE_2D, null);
      const last = bands.at(-1);
      return last ? last[0] + last[1] : row;
    };
    if (upload.lightmapRow < lighting.height) {
      upload.lightmapRow = write(target.lightmap, lighting.width, lighting.data, upload.lightmapRow, lighting.height);
    } else if (lighting.catcher && target.catcher && upload.catcherRow < lighting.catcher.height) {
      const { width, height, data } = lighting.catcher;
      upload.catcherRow = write(target.catcher.texture, width, data, upload.catcherRow, height);
    }
    const done =
      upload.lightmapRow >= lighting.height && (!lighting.catcher || upload.catcherRow >= lighting.catcher.height);
    if (!done) return true;
    target.source = lighting;
    gpu.spare = gpu.lighting;
    gpu.lighting = target;
    gpu.upload = null;
    this.dirty = true;
    return false;
  }

  setCamera(camera: SceneCamera): void {
    this.camera = camera;
    this.dirty = true;
  }

  /** The rounded edges drawn with. */
  get edgeLook(): EdgeLook {
    return this.edges;
  }

  /**
   * Changes the rounded edges; fields left out keep their current value. A value out of range throws a `RangeError`
   * naming the field and changes nothing. A new width is a uniform; a new sharp angle detects the edges again (once per
   * mesh and angle, `cachedSharpEdges`) and uploads the geometry again.
   */
  setEdges(edges: Partial<EdgeLook>): void {
    const next = checkEdgeLook(edges, this.edges);
    const angleChanged = next.sharpAngleDeg !== this.edges.sharpAngleDeg;
    if (!angleChanged && next.width === this.edges.width) return;
    this.edges = next;
    const gpu = this.gpu;
    if (angleChanged && gpu?.scene && this.loaded && !this.lost) {
      disposeGpuScene(this.gl, gpu.scene);
      gpu.scene = null;
      gpu.scene = this.uploadGeometry(this.loaded);
    }
    this.dirty = true;
  }

  /** Sizes the backing store from the element's CSS size and pixel ratio, clamped to the GPU limits. */
  resize(size: CanvasCssSize): CanvasSize {
    const limits = this.gpu?.capabilities.limits ?? queryGlLimits(this.gl);
    const result = canvasSize(size, {
      maxWidth: Math.min(limits.maxViewport[0], limits.maxRenderbufferSize),
      maxHeight: Math.min(limits.maxViewport[1], limits.maxRenderbufferSize),
      ...(this.options.maxPixels !== undefined ? { maxPixels: this.options.maxPixels } : {}),
    });
    if (this.canvas.width !== result.width || this.canvas.height !== result.height) {
      this.canvas.width = result.width;
      this.canvas.height = result.height;
      this.dirty = true;
    }
    return result;
  }

  /** Called after the context came back and the scene was redrawn. Returns a function that removes the listener. */
  onContextRestored(listener: () => void): () => void {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
  }

  /** Draws one frame now. A no-op while the context is lost or after `dispose()`. */
  render(): void {
    const gpu = this.gpu;
    if (!gpu || this.lost || this.disposed || this.gl.isContextLost()) return;
    this.advanceLighting();
    this.dirty = false;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (gpu.targets && !gpu.targets.ensure(width, height)) this.switchToFallback(gpu);
    const frame = this.frameView(gpu, width, height);
    this.frameDepthKey = frame?.mode ?? null;
    if (gpu.targets) this.drawFloatPath(gpu, gpu.targets, frame);
    else this.drawFallbackPath(gpu, frame);
  }

  /** The camera of this frame, and the depth-key variant the scene and this depth range need (`depthKeyMode`). */
  private frameView(gpu: GpuResources, width: number, height: number): FrameView | null {
    const camera = this.camera;
    if (!camera) return null;
    const projection = cameraProjection(camera, width / height);
    const view = cameraView(camera);
    const depthBits = gpu.targets ? FLOAT_PATH_DEPTH_BITS : this.defaultDepthBits();
    const mode = depthKeyMode(camera, depthBits, gpu.scene?.hasRenderOrder ?? false);
    // A scene with render order got its exact geometry at upload; an order-0 scene builds it once, on the first frame
    // inside its bounding sphere.
    if (mode === 'exact' && gpu.scene && !gpu.scene.exact) gpu.scene.exact = uploadExactGeometry(this.gl, gpu.scene);
    return {
      view: new Float32Array(view),
      projection,
      inverseProjection: new Float32Array(invertMat4(projection)),
      viewProjection: new Float32Array(mat4Multiply(projection, view)),
      far: camera.far,
      eye: camera.position,
      near: camera.near,
      mode,
      viewport: [width, height],
    };
  }

  /** Depth bits of the default framebuffer (the no-float path draws there; WebGL guarantees only 16). */
  private defaultDepthBits(): number {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const bits = Number(gl.getParameter(gl.DEPTH_BITS));
    return Number.isFinite(bits) && bits > 0 ? bits : 16;
  }

  /** Releases every GL object and decoded image and stops listening; a pending `setScene` is superseded. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseScene();
    if (this.gpu && !this.lost) this.releaseGpuResources(this.gpu);
    this.gpu = null;
    this.restoredListeners.clear();
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && !this.disposed;
  }

  private textureLimits(): TextureLimits {
    const maxTextureSize = this.gpu?.capabilities.limits.maxTextureSize ?? DEFAULT_MAX_TEXTURE_SIDE;
    return {
      maxTextureSide: Math.min(this.options.maxTextureSide ?? DEFAULT_MAX_TEXTURE_SIDE, maxTextureSize),
      maxTexturePixelsTotal: this.options.maxTexturePixelsTotal ?? DEFAULT_MAX_TEXTURE_PIXELS_TOTAL,
    };
  }

  private createGpuResources(): GpuResources {
    const gl = this.gl;
    const limits = queryGlLimits(gl);
    let targets: RenderTargets | null = null;
    if (limits.colorBufferFloat && !this.options.forceFallback) {
      const samples = Math.min(this.options.maxMsaaSamples ?? DEFAULT_MSAA_SAMPLES, limits.maxSamplesRgba16f);
      targets = new RenderTargets(gl, Math.max(0, samples));
      if (!targets.ensure(1, 1)) {
        targets.dispose();
        targets = null;
      }
    }
    const programs = createRendererPrograms(gl, targets !== null);
    const unbakedLight = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, unbakedLight);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 1, 1);
    // Half-float 1.0 in all four channels.
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.HALF_FLOAT, new Uint16Array(4).fill(0x3c00));
    setNearest(gl);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return {
      programs,
      targets,
      fullscreenVao: gl.createVertexArray(),
      placeholder: uploadTexture(gl, PLACEHOLDER_IMAGE),
      untextured: uploadTexture(gl, UNTEXTURED_IMAGE),
      capabilities: { path: targets ? 'float' : 'fallback', msaaSamples: targets?.samples ?? 0, limits },
      sceneTextures: [],
      scene: null,
      unbakedLight,
      lighting: null,
      upload: null,
      spare: null,
    };
  }

  /** Textures (and the catcher's quad) of the shape of `lighting`, not yet written. */
  private createGpuLighting(lighting: BakedLighting): GpuLighting {
    const gl = this.gl;
    const allocate = (width: number, height: number): WebGLTexture => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, width, height);
      setNearest(gl);
      gl.bindTexture(gl.TEXTURE_2D, null);
      return texture;
    };
    const lightmap = allocate(lighting.width, lighting.height);
    let catcher: GpuLighting['catcher'] = null;
    if (lighting.catcher) {
      const { y, rect, width, height } = lighting.catcher;
      const texture = allocate(width, height);
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Counter-clockwise seen from above: the catcher is one-sided.
      const quad = [rect[0], y, rect[3], rect[2], y, rect[3], rect[2], y, rect[1], rect[0], y, rect[1]];
      const corners = [0, 1, 2, 0, 2, 3].flatMap((i) => quad.slice(i * 3, i * 3 + 3));
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      catcher = { texture, vao, buffer };
    }
    return { source: lighting, lightmap, catcher };
  }

  /** Starts uploading `lighting` into textures of its shape: the pending upload's, the spare ones, or new ones. */
  private beginUpload(gpu: GpuResources, lighting: BakedLighting): void {
    const candidates = [gpu.upload?.target ?? null, gpu.spare];
    gpu.upload = null;
    gpu.spare = null;
    let target: GpuLighting | null = null;
    for (const candidate of candidates) {
      if (candidate && !target && sameShape(candidate.source, lighting)) target = candidate;
      else if (candidate) this.deleteGpuLighting(candidate);
    }
    gpu.upload = {
      target: target ?? this.createGpuLighting(lighting),
      lighting,
      lightmapRow: 0,
      catcherRow: 0,
    };
  }

  /** Uploads the retained lighting at once (a rebuilt context), in place of what the GPU had. */
  private uploadLighting(gpu: GpuResources): void {
    this.releaseGpuLighting(gpu);
    if (!this.lighting) return;
    this.beginUpload(gpu, this.lighting);
    while (this.advanceLighting());
  }

  private deleteGpuLighting(lighting: GpuLighting): void {
    if (this.lost) return;
    const gl = this.gl;
    gl.deleteTexture(lighting.lightmap);
    if (lighting.catcher) {
      gl.deleteTexture(lighting.catcher.texture);
      gl.deleteVertexArray(lighting.catcher.vao);
      gl.deleteBuffer(lighting.catcher.buffer);
    }
  }

  private releaseGpuLighting(gpu: GpuResources): void {
    for (const lighting of [gpu.lighting, gpu.spare, gpu.upload?.target ?? null]) {
      if (lighting) this.deleteGpuLighting(lighting);
    }
    gpu.lighting = null;
    gpu.spare = null;
    gpu.upload = null;
  }

  private dropLighting(): void {
    this.lighting = null;
    if (this.gpu) this.releaseGpuLighting(this.gpu);
  }

  /** Float targets the driver rejects at this size: draw on the no-float path from now on. */
  private switchToFallback(gpu: GpuResources): void {
    const gl = this.gl;
    gpu.targets?.dispose();
    gpu.targets = null;
    for (const program of gpu.programs.all) gl.deleteProgram(program);
    gpu.programs = createRendererPrograms(gl, false);
    gpu.capabilities = { ...gpu.capabilities, path: 'fallback', msaaSamples: 0 };
  }

  private uploadLoadedScene(gpu: GpuResources): void {
    const loaded = this.loaded;
    if (!loaded) return;
    const gl = this.gl;
    gpu.sceneTextures = loaded.bitmaps.map((bitmap) => (bitmap ? uploadTexture(gl, bitmap) : null));
    if (!loaded.alphaLevels || !loaded.closedOpaque) {
      const alpha = loaded.bitmaps.map((bitmap, index) => {
        const texture = gpu.sceneTextures[index];
        return bitmap && texture ? readTextureAlpha(gl, texture, bitmap.width, bitmap.height) : null;
      });
      loaded.alphaLevels = alpha.map((texture) => texture?.levels ?? null);
      // A texture without an image draws the opaque placeholder. The translucent-texel tables are needed only here;
      // the per-mesh result is kept for a rebuilt context.
      loaded.closedOpaque = closedOpaqueMeshes(
        loaded.doc,
        alpha.map((texture) => texture?.opacity ?? 'opaque'),
      );
    }
    gpu.scene = this.uploadGeometry(loaded);
  }

  /** Uploads the loaded scene's geometry with its sharp edges under the current angle. */
  private uploadGeometry(loaded: LoadedScene): GpuScene {
    const { doc } = loaded;
    const options = { sharpAngleDeg: this.edges.sharpAngleDeg, reach: MAX_EDGE_WIDTH };
    const visibility = nodeVisibility(doc);
    const edges: (SharpEdgeAttributes | null)[] = doc.meshes.map((mesh, m) =>
      meshVisible(doc, m, visibility) ? cachedSharpEdges(mesh, options) : null,
    );
    return uploadScene(
      this.gl,
      doc,
      loaded.alphaLevels ?? [],
      loaded.closedOpaque ?? [],
      loaded.layout.vertexData,
      edges,
    );
  }

  private releaseScene(): void {
    const gpu = this.gpu;
    if (gpu && !this.lost) {
      if (gpu.scene) disposeGpuScene(this.gl, gpu.scene);
      for (const texture of gpu.sceneTextures) if (texture) this.gl.deleteTexture(texture);
    }
    if (gpu) {
      gpu.scene = null;
      gpu.sceneTextures = [];
    }
    for (const bitmap of this.loaded?.bitmaps ?? []) bitmap?.close();
    this.loaded = null;
  }

  private releaseGpuResources(gpu: GpuResources): void {
    const gl = this.gl;
    if (gpu.scene) disposeGpuScene(gl, gpu.scene);
    for (const texture of gpu.sceneTextures) if (texture) gl.deleteTexture(texture);
    for (const program of gpu.programs.all) gl.deleteProgram(program);
    gpu.targets?.dispose();
    gl.deleteVertexArray(gpu.fullscreenVao);
    gl.deleteTexture(gpu.placeholder);
    gl.deleteTexture(gpu.untextured);
    gl.deleteTexture(gpu.unbakedLight);
    this.releaseGpuLighting(gpu);
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
      this.gpu = this.createGpuResources();
      this.uploadLoadedScene(this.gpu);
      this.uploadLighting(this.gpu);
    } catch {
      this.gpu = null;
      return;
    }
    this.render();
    for (const listener of [...this.restoredListeners]) listener();
  };

  private textureFor(gpu: GpuResources, index: number): WebGLTexture {
    if (index < 0) return gpu.untextured;
    return gpu.sceneTextures[index] ?? gpu.placeholder;
  }

  /**
   * Draws `items` (sorted by render order, descending) with the frame's variant of `passName`. Per render order: the
   * front faces of every item (back faces culled), then the back faces of double-sided items (front faces culled).
   * Exact frames key each fragment by `order` (a back face `order + BACK_SIDE_RENDER_ORDER`) in the shader. Raster
   * frames carry only order 0: the front pass is drawn as is and the back pass gets `polygonOffset(4, 4)`, a
   * slope-scaled push that keeps a back side behind the front face it meets at a silhouette (the −1/16 order is below
   * the interpolation error there), and skips closed batches opaque on every face while the camera is outside their
   * bounds and the near plane does not reach them (`backSidesVisible`). The depth test is set by the caller.
   */
  private drawItems(gpu: GpuResources, passName: MeshPassName, items: readonly DrawItem[], frame: FrameView): void {
    const pass = gpu.programs.meshPasses[frame.mode][passName];
    if (!pass) return;
    const gl = this.gl;
    gl.useProgram(pass.program);
    gl.uniformMatrix4fv(pass.view, false, frame.view);
    gl.uniformMatrix4fv(pass.viewProjection, false, frame.viewProjection);
    gl.uniformMatrix4fv(pass.inverseProjection, false, frame.inverseProjection);
    gl.uniform2f(pass.viewportSize, frame.viewport[0], frame.viewport[1]);
    const [depthOffset, depthScale] = exactDepthRange(frame.far);
    gl.uniform2f(pass.depthRange, depthOffset, depthScale);
    const exact = frame.mode === 'exact' ? gpu.scene?.exact : null;
    const noPull = new Float32Array(4);
    gl.uniform1i(pass.texture, 0);
    gl.uniform1i(pass.texelAntialias, this.options.texelAntialias === false ? 0 : 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpu.lighting?.lightmap ?? gpu.unbakedLight);
    gl.uniform1i(pass.lightmap, 1);
    gl.uniform1i(pass.bakeOn, gpu.lighting ? 1 : 0);
    gl.uniform1f(pass.edgeWidth, this.edges.width);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.CULL_FACE);
    const draw = (item: DrawItem, order: number): void => {
      gl.uniform4fv(pass.depthPull, exact ? noPull : depthPull(frame.projection, order));
      gl.uniform1f(pass.orderPull, order * RENDER_ORDER_TIE_DISTANCE);
      gl.uniform1i(pass.alphaMode, item.alpha.modeId);
      gl.uniform1i(pass.alphaCutoffByte, item.alpha.cutoffByte);
      gl.bindTexture(gl.TEXTURE_2D, this.textureFor(gpu, item.texture));
      gl.uniform2f(pass.lightmapTextureSize, item.textureSize[0], item.textureSize[1]);
      gl.uniformMatrix4fv(pass.model, false, item.model);
      const exactVao = exact?.vaos.get(item.batch);
      if (exactVao) {
        gl.bindVertexArray(exactVao);
        gl.drawArrays(gl.TRIANGLES, 0, item.count);
      } else {
        gl.bindVertexArray(item.vao);
        gl.drawElements(gl.TRIANGLES, item.count, gl.UNSIGNED_INT, item.offset);
      }
    };
    for (let first = 0; first < items.length;) {
      const order = items[first]?.renderOrder ?? 0;
      let end = first;
      while (end < items.length && items[end]?.renderOrder === order) end++;
      const level = items.slice(first, end);
      gl.cullFace(gl.BACK);
      for (const item of level) draw(item, order);
      gl.cullFace(gl.FRONT);
      if (exact) {
        for (const item of level) if (!item.cull) draw(item, order + BACK_SIDE_RENDER_ORDER);
      } else {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        // Slope factor 4: MSAA samples next to a silhouette compare against the front face's depth up to about a
        // pixel away; factors 1 and 2 still let back sides through there (closed-cube-cutout test).
        gl.polygonOffset(4, 4);
        for (const item of level) {
          // A closed batch opaque on every face shows no back side from outside its bounds; drawing them anyway
          // would let them through MSAA samples beside a near edge-on face (docs/realtime-renderer.md).
          const hidden = item.closedBounds && !backSidesVisible(item.closedBounds, frame.eye, frame.view, frame.near);
          if (!item.cull && !hidden) draw(item, order);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      first = end;
    }
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * The shadow catcher, drawn right after the backdrop without depth test or write: it is one-sided from above and
   * lies at the model's lowest point, so a camera ray meets any model surface before the plane, and the model drawn
   * next covers it wherever both are seen, in either depth-key variant.
   */
  private drawCatcher(gpu: GpuResources, frame: FrameView, toneMap: boolean): void {
    const catcher = gpu.lighting?.catcher;
    const baked = gpu.lighting?.source.catcher;
    if (!catcher || !baked) return;
    const gl = this.gl;
    const { program, uniforms } = gpu.programs.catcher;
    gl.useProgram(program);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.uniformMatrix4fv(uniforms['u_viewProjection'] ?? null, false, frame.viewProjection);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, catcher.texture);
    gl.uniform1i(uniforms['u_catcherLight'] ?? null, 0);
    gl.uniform4fv(uniforms['u_catcherRect'] ?? null, baked.rect);
    gl.uniform2f(uniforms['u_catcherSize'] ?? null, baked.width, baked.height);
    gl.uniform3fv(uniforms['u_background'] ?? null, this.background);
    gl.uniform1i(uniforms['u_toneMap'] ?? null, toneMap ? 1 : 0);
    gl.bindVertexArray(catcher.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
  }

  private drawFloatPath(gpu: GpuResources, targets: RenderTargets, frame: FrameView | null): void {
    const gl = this.gl;
    const { width, height } = targets;
    const scene = frame ? gpu.scene : null;
    const { oitComposite, present } = gpu.programs.fullscreen;
    if (!oitComposite || !present) return;

    // Exact frames draw single-sampled: their per-fragment key is the depth at the pixel centre, which is the only
    // sample there; with MSAA it would stand for every covered sample, wrongly for a face whose depth changes a lot
    // inside one pixel (grazing angles), letting a hidden face win samples.
    const msaa = frame?.mode === 'exact' ? null : targets.msaaFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa ?? targets.resolveFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearBufferfv(gl.COLOR, 0, [...this.background, 1]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    if (frame) this.drawCatcher(gpu, frame, false);
    gl.enable(gl.DEPTH_TEST);
    if (scene && frame) this.drawItems(gpu, 'opaque', scene.opaque, frame);

    if (msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.resolveFramebuffer);
      gl.blitFramebuffer(
        0,
        0,
        width,
        height,
        0,
        0,
        width,
        height,
        gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT,
        gl.NEAREST,
      );
    }

    if (scene && frame && scene.partial.length > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.oitFramebuffer);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      this.drawItems(gpu, 'oitAccum', scene.partial, frame);

      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.resolveFramebuffer);
      gl.disable(gl.DEPTH_TEST);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(oitComposite.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, targets.accum);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, targets.weight);
      gl.uniform1i(oitComposite.uniforms['u_accum'] ?? null, 0);
      gl.uniform1i(oitComposite.uniforms['u_weight'] ?? null, 1);
      gl.bindVertexArray(gpu.fullscreenVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.useProgram(present.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.hdr);
    gl.uniform1i(present.uniforms['u_hdr'] ?? null, 0);
    gl.bindVertexArray(gpu.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  private drawFallbackPath(gpu: GpuResources, frame: FrameView | null): void {
    const gl = this.gl;
    const { backdrop } = gpu.programs.fullscreen;
    if (!backdrop) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(backdrop.program);
    gl.uniform3f(backdrop.uniforms['u_background'] ?? null, ...this.background);
    gl.bindVertexArray(gpu.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (frame) this.drawCatcher(gpu, frame, true);
    if (gpu.scene && frame) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      this.drawItems(gpu, 'fallback', gpu.scene.opaque, frame);
      gl.disable(gl.DEPTH_TEST);
    }
    gl.bindVertexArray(null);
  }
}

function summarize(layout: LightmapLayoutSummary): LightmapLayoutSummary {
  const { width, height, downscale, vertexData, finestTexel, layoutKey } = layout;
  return { width, height, downscale, vertexData, finestTexel, layoutKey };
}

/** Same lightmap size and the same catcher plane and size: the GPU textures and the catcher quad still fit. */
function sameShape(a: BakedLighting, b: BakedLighting): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (!a.catcher || !b.catcher) return a.catcher === b.catcher;
  const [p, q] = [a.catcher, b.catcher];
  return p.width === q.width && p.height === q.height && p.y === q.y && p.rect.every((v, i) => v === q.rect[i]);
}

function setNearest(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}
