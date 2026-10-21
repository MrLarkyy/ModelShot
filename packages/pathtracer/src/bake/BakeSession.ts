import type { RawImage, ShadowCatcherPlane } from '@modelshot/renderer-rt';
import { AccumulationTargets } from '../accumulationTargets';
import { disposeGpuScene, uploadData, uploadGpuScene, type GpuScene } from '../gpuScene';
import { DATA_TEXTURE_WIDTH, type DataTexture, type PackedGeometry } from '../packSceneData';
import { requireExactAccumulation } from '../requireExactAccumulation';
import type { TextureLayerPlan } from '../textureLayers';
import { linkTracerProgram, type TracerProgram } from '../tracerPrograms';
import type { ChartTable } from './chartTable';

/** Everything a bake draws from, kept on the CPU so a lost context can be rebuilt without building it again. */
export interface BakeScene {
  readonly geometry: PackedGeometry;
  readonly materials: DataTexture;
  readonly plan: TextureLayerPlan;
  readonly images: readonly (ImageBitmap | RawImage)[];
  readonly charts: ChartTable;
  readonly catcher: ShadowCatcherPlane | null;
}

/** A rectangle of lightmap texels drawn in one draw call. */
export interface BakeTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type BakePass = 'model' | 'catcher';

/** Limits of the context, read when the session was created (a lost context answers nothing). */
export interface BakeLimits {
  readonly maxTextureSize: number;
  readonly maxArrayTextureLayers: number;
}

interface SceneTextures {
  readonly gpu: GpuScene;
  readonly charts: WebGLTexture;
  readonly chartTriangles: WebGLTexture;
  readonly chartIndex: WebGLTexture;
  readonly model: AccumulationTargets;
  readonly catcher: AccumulationTargets | null;
}

/**
 * The light bake's GL state on one WebGL2 context (an OffscreenCanvas in the bake worker): the bake program, a
 * scene's data and two RGBA32F sums per pass (model lightmap, shadow catcher), added to in sample order like the path
 * tracer's accumulation, so the result does not depend on tiles or batches. Throws `PathTracerError`
 * `FLOAT_TARGETS_UNAVAILABLE`, `HIGHP_UNAVAILABLE` or a shader error at creation.
 */
export class BakeSession {
  private readonly program: TracerProgram;
  private readonly vao: WebGLVertexArrayObject;
  private scene: SceneTextures | null = null;
  readonly limits: BakeLimits;

  constructor(private readonly gl: WebGL2RenderingContext) {
    requireExactAccumulation(gl);
    const positive = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
    this.limits = {
      maxTextureSize: positive(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2048),
      maxArrayTextureLayers: positive(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS), 256),
    };
    this.program = linkTracerProgram(gl, 'bake');
    this.vao = gl.createVertexArray();
  }

  /** Uploads `scene` (replacing the previous one) and zeroes both sums. */
  upload(scene: BakeScene): void {
    this.releaseScene();
    const gl = this.gl;
    const gpu = uploadGpuScene(gl, scene.geometry, scene.materials, scene.plan, scene.images);
    const chartIndex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, chartIndex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, scene.charts.width, scene.charts.height);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      scene.charts.width,
      scene.charts.height,
      gl.RED_INTEGER,
      gl.UNSIGNED_INT,
      scene.charts.index,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.scene = {
      gpu,
      charts: uploadData(gl, scene.charts.charts),
      chartTriangles: uploadData(gl, scene.charts.triangles),
      chartIndex,
      model: new AccumulationTargets(gl, scene.charts.width, scene.charts.height),
      catcher: scene.catcher ? new AccumulationTargets(gl, scene.catcher.width, scene.catcher.height) : null,
    };
  }

  /** Zeroes both sums (a new bake of the same scene). */
  clear(): void {
    this.scene?.model.clear();
    this.scene?.catcher?.clear();
  }

  /**
   * Draws sample `sample` of `seed` for the texels of `tile` into the pass's next sum; `finishSample` makes it the
   * current one once every tile of the sample is drawn. `countCapped` (test hook) sums capped traversals instead.
   */
  drawTile(pass: BakePass, scene: BakeScene, seed: number, sample: number, tile: BakeTile, countCapped = false): void {
    const textures = this.scene;
    const targets = pass === 'model' ? textures?.model : textures?.catcher;
    if (!textures || !targets) return;
    const gl = this.gl;
    const { program, uniform } = this.program;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.next.framebuffer);
    gl.viewport(0, 0, targets.width, targets.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(tile.x, tile.y, tile.width, tile.height);
    gl.bindVertexArray(this.vao);
    const bound: [string, number, WebGLTexture][] = [
      ['u_previous', gl.TEXTURE_2D, targets.sum.texture],
      ['u_nodes', gl.TEXTURE_2D, textures.gpu.nodes],
      ['u_triPositions', gl.TEXTURE_2D, textures.gpu.triPositions],
      ['u_triAttributes', gl.TEXTURE_2D, textures.gpu.triAttributes],
      ['u_materials', gl.TEXTURE_2D, textures.gpu.materials],
      ['u_textureLayers', gl.TEXTURE_2D_ARRAY, textures.gpu.layers],
      ['u_chartIndex', gl.TEXTURE_2D, textures.chartIndex],
      ['u_charts', gl.TEXTURE_2D, textures.charts],
      ['u_chartTriangles', gl.TEXTURE_2D, textures.chartTriangles],
    ];
    bound.forEach(([name, target, texture], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(target, texture);
      gl.uniform1i(uniform(name), i);
    });
    gl.uniform1i(uniform('u_dataWidth'), DATA_TEXTURE_WIDTH);
    gl.uniform1i(uniform('u_nodeCount'), textures.gpu.nodeCount);
    gl.uniform1f(uniform('u_maxRenderOrder'), textures.gpu.maxRenderOrder);
    gl.uniform1f(uniform('u_orderTie'), 0);
    gl.uniform1f(uniform('u_backSideOrder'), 0);
    gl.uniform1ui(uniform('u_seed'), seed);
    gl.uniform1ui(uniform('u_sample'), sample);
    const catcher = scene.catcher;
    gl.uniform1i(uniform('u_catcherPass'), pass === 'catcher' ? 1 : 0);
    gl.uniform1f(uniform('u_catcherY'), catcher?.y ?? 0);
    gl.uniform4fv(uniform('u_catcherRect'), catcher?.rect ?? [0, 0, 1, 1]);
    gl.uniform2f(uniform('u_catcherSize'), catcher?.width ?? 1, catcher?.height ?? 1);
    gl.uniform1i(uniform('u_countCapped'), countCapped ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    for (let i = 0; i < bound.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(bound[i]?.[1] ?? gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Every tile of the sample is drawn: its sums become the pass's current ones. */
  finishSample(pass: BakePass): void {
    const targets = pass === 'model' ? this.scene?.model : this.scene?.catcher;
    targets?.swap();
  }

  /** The pass's float sums, rows from y = 0 up; `null` without a scene or catcher. */
  read(pass: BakePass): Float32Array | null {
    const targets = pass === 'model' ? this.scene?.model : this.scene?.catcher;
    return targets ? targets.read() : null;
  }

  dispose(): void {
    this.releaseScene();
    this.gl.deleteProgram(this.program.program);
    this.gl.deleteVertexArray(this.vao);
  }

  private releaseScene(): void {
    const scene = this.scene;
    if (!scene) return;
    const gl = this.gl;
    disposeGpuScene(gl, scene.gpu);
    for (const texture of [scene.charts, scene.chartTriangles, scene.chartIndex]) gl.deleteTexture(texture);
    scene.model.dispose();
    scene.catcher?.dispose();
    this.scene = null;
  }
}
