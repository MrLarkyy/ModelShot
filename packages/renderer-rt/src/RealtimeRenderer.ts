import { cameraProjection, cameraView, mat4Multiply, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import { canvasSize, type CanvasCssSize, type CanvasSize } from './canvasSize';
import { DEFAULT_MAX_TEXTURE_PIXELS_TOTAL, decodeTextures, type TextureLimits } from './decodeTextures';
import { queryGlLimits, type GlLimits } from './glLimits';
import { createRendererPrograms, type MeshProgram, type RendererPrograms } from './rendererPrograms';
import { RendererError } from './RendererError';
import type { RendererWarning } from './RendererWarning';
import { RenderTargets } from './RenderTargets';
import { PLACEHOLDER_IMAGE, UNTEXTURED_IMAGE, readPartialAlpha, uploadTexture } from './textureUpload';
import { disposeGpuScene, uploadScene, type DrawItem, type GpuScene } from './uploadScene';
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

const DEFAULT_BACKGROUND = [0.14, 0.15, 0.17] as const;
const DEFAULT_MAX_TEXTURE_SIDE = 4096;
const DEFAULT_MSAA_SAMPLES = 4;

interface LoadedScene {
  readonly doc: SceneDocument;
  /** Decoded images, kept so a lost context can be rebuilt without decoding again. */
  readonly bitmaps: readonly (ImageBitmap | null)[];
  /** Per texture: partial alpha, read back once and kept CPU-side. */
  partial: boolean[] | null;
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
  private readonly restoredListeners = new Set<() => void>();
  private readonly background: readonly [number, number, number];

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    private readonly options: RendererOptions,
  ) {
    this.background = options.background ?? DEFAULT_BACKGROUND;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    try {
      this.gpu = this.createGpuResources();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** Creates the WebGL2 context on `canvas`; throws `RendererError` `WEBGL2_UNAVAILABLE` or a shader error. */
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

  /** Something changed since the last `render()`. */
  get needsRender(): boolean {
    return this.dirty && !this.lost && !this.disposed;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  /**
   * Validates `doc` (a malformed one rejects with `RendererError` `INVALID_SCENE`), decodes its textures off the
   * drawing path and swaps it in. A later call or `dispose()` supersedes a pending one: it resolves with
   * `applied: false` and releases what it decoded.
   */
  async setScene(doc: SceneDocument): Promise<SetSceneResult> {
    if (this.disposed) return { applied: false, warnings: [] };
    validateScene(doc);
    const generation = ++this.generation;
    const decoded = await decodeTextures(doc.textures, this.textureLimits(), () => this.isCurrent(generation));
    if (!decoded) return { applied: false, warnings: [] };
    this.releaseScene();
    this.loaded = { doc, bitmaps: decoded.bitmaps, partial: null };
    if (this.gpu && !this.lost) this.uploadLoadedScene(this.gpu);
    this.dirty = true;
    return { applied: true, warnings: decoded.warnings };
  }

  setCamera(camera: SceneCamera): void {
    this.camera = camera;
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
    this.dirty = false;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const viewProjection = this.camera
      ? new Float32Array(mat4Multiply(cameraProjection(this.camera, width / height), cameraView(this.camera)))
      : null;
    if (gpu.targets && !gpu.targets.ensure(width, height)) this.switchToFallback(gpu);
    if (gpu.targets) this.drawFloatPath(gpu, gpu.targets, viewProjection);
    else this.drawFallbackPath(gpu, viewProjection);
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
    return {
      programs,
      targets,
      fullscreenVao: gl.createVertexArray(),
      placeholder: uploadTexture(gl, PLACEHOLDER_IMAGE),
      untextured: uploadTexture(gl, UNTEXTURED_IMAGE),
      capabilities: { path: targets ? 'float' : 'fallback', msaaSamples: targets?.samples ?? 0, limits },
      sceneTextures: [],
      scene: null,
    };
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
    loaded.partial ??= loaded.bitmaps.map((bitmap, index) => {
      const texture = gpu.sceneTextures[index];
      return bitmap && texture ? readPartialAlpha(gl, texture, bitmap.width, bitmap.height) : false;
    });
    gpu.scene = uploadScene(gl, loaded.doc, loaded.partial);
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

  private drawItems(
    gpu: GpuResources,
    pass: MeshProgram,
    items: readonly DrawItem[],
    viewProjection: Float32Array,
  ): void {
    const gl = this.gl;
    gl.useProgram(pass.program);
    gl.uniformMatrix4fv(pass.viewProjection, false, viewProjection);
    gl.uniform1i(pass.texture, 0);
    gl.uniform1i(pass.texelAntialias, this.options.texelAntialias === false ? 0 : 1);
    gl.activeTexture(gl.TEXTURE0);
    // Double-sided, front faces first: back faces are drawn in a second pass pushed back by a polygon offset, so of
    // two coincident faces (a zero-thickness element) the one facing the camera always wins, on any GPU.
    gl.enable(gl.CULL_FACE);
    for (const side of [gl.BACK, gl.FRONT]) {
      gl.cullFace(side);
      if (side === gl.FRONT) {
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
      }
      for (const item of items) {
        gl.bindTexture(gl.TEXTURE_2D, this.textureFor(gpu, item.texture));
        gl.uniformMatrix4fv(pass.model, false, item.model);
        gl.bindVertexArray(item.vao);
        gl.drawElements(gl.TRIANGLES, item.count, gl.UNSIGNED_INT, item.offset);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  }

  private drawFloatPath(gpu: GpuResources, targets: RenderTargets, viewProjection: Float32Array | null): void {
    const gl = this.gl;
    const { width, height } = targets;
    const scene = viewProjection ? gpu.scene : null;
    const { opaque, oitAccum } = gpu.programs.meshPasses;
    const { oitComposite, present } = gpu.programs.fullscreen;
    if (!opaque || !oitAccum || !oitComposite || !present) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.msaaFramebuffer ?? targets.resolveFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearBufferfv(gl.COLOR, 0, [...this.background, 1]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    if (scene && viewProjection) this.drawItems(gpu, opaque, scene.opaque, viewProjection);

    if (targets.msaaFramebuffer) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.msaaFramebuffer);
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

    if (scene && viewProjection && scene.partial.length > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.oitFramebuffer);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
      this.drawItems(gpu, oitAccum, scene.partial, viewProjection);

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

  private drawFallbackPath(gpu: GpuResources, viewProjection: Float32Array | null): void {
    const gl = this.gl;
    const { fallback } = gpu.programs.meshPasses;
    const { backdrop } = gpu.programs.fullscreen;
    if (!fallback || !backdrop) return;
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
    if (gpu.scene && viewProjection) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      this.drawItems(gpu, fallback, gpu.scene.opaque, viewProjection);
      gl.disable(gl.DEPTH_TEST);
    }
    gl.bindVertexArray(null);
  }
}
