import { RendererError, validateScene, type BakedLighting } from '@modelshot/renderer-rt';
import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import type { BakeReply, BakeRequest } from './bake/bakeMessages';
import { streamMeshes } from './bake/meshStream';
import { DEFAULT_MAX_TRIANGLES } from './flattenScene';
import { MAX_SEED } from './PathTracer';
import { PathTracerError, type PathTracerErrorCode } from './PathTracerError';
import type { PathTracerWarning } from './PathTracerWarning';

export const MAX_BAKE_SAMPLES = 1024;
const DEFAULT_BAKE_SAMPLES = 64;
const DEFAULT_BAKE_TILE = 64;

export interface LightBakerOptions {
  /** Triangles of visible meshes accepted. Default 200 000 (the loaders' limit). */
  readonly maxTriangles?: number;
  /** Enables `loseContext()` and `BakeOptions.countCappedTraversals`, for tests. Default `false`. */
  readonly testHooks?: boolean;
}

/** The lighting so far of a running bake. */
export interface BakeProgress {
  readonly samplesDone: number;
  readonly samples: number;
  readonly lighting: BakedLighting;
}

export interface BakeOptions {
  /** Samples per lightmap texel, integer 1..1024. Default 64. */
  readonly samples?: number;
  /** Integer 0..2^32 − 1. Default 1. */
  readonly seed?: number;
  /** Bake the shadow catcher too (`BakedLighting.catcher`). Default `true`. */
  readonly shadowCatcher?: boolean;
  /** Side of the square lightmap tiles one draw covers, 16..512. Default 64. Changes no texel's value. */
  readonly tileSize?: number;
  /** Called with the lighting after samples 4, 16, 64, … (every fourfold) below `samples`. */
  readonly onProgress?: (progress: BakeProgress) => void;
  /**
   * Test hook (`testHooks: true`): every texel holds the mean count of its rays' traversals stopped at the per-ray
   * node cap instead of light, so a test can show that real scenes never reach the cap.
   */
  readonly countCappedTraversals?: boolean;
}

export interface BakeResult {
  /** `false` when a later `bake` or `dispose` superseded this call: `lighting` is `null`. */
  readonly applied: boolean;
  readonly warnings: readonly PathTracerWarning[];
  readonly lighting: BakedLighting | null;
}

/** A bake request before its document is posted: what `post` turns into messages. */
type BakeParameters = Omit<
  Extract<BakeRequest, { type: 'bake' }>,
  'doc' | 'meshIds' | 'texturesVersion' | 'texturesIncluded'
>;

interface Pending {
  /** Kept to post (again, when the worker asks: `resend`). */
  readonly doc: SceneDocument;
  readonly parameters: BakeParameters;
  readonly samples: number;
  readonly onProgress: ((progress: BakeProgress) => void) | undefined;
  readonly resolve: (result: BakeResult) => void;
  readonly reject: (error: unknown) => void;
}

const NOT_APPLIED: BakeResult = Object.freeze({ applied: false, warnings: [], lighting: null });

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function checkInteger(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in ${min}..${max}, got ${String(value)}`);
  }
  return value;
}

/**
 * Bakes the light of a `SceneDocument` for the realtime preview off the main thread: a module Worker on an
 * OffscreenCanvas runs the path tracer's own ray rules (alpha per texel, sides, the key's cone) for every lightmap
 * texel of `lightmapLayout`, and for the shadow catcher. The main thread only validates and posts the document; the
 * worker flattens, builds the BVH, decodes the textures (from their bytes, never fetched) and draws one tile at a time,
 * at most one draw in flight. Deterministic: the lighting is a pure function of the document, seed, sample count and
 * catcher option. No main-thread fallback: without workers or WebGL2 there, `create` throws or `bake` rejects.
 */
export class LightBaker {
  private readonly pending = new Map<number, Pending>();
  private latest = 0;
  private texturesVersion = 0;
  private sentTextures: SceneDocument['textures'] | null = null;
  /** Meshes the worker holds, by the ids they were streamed under; a later bake of the same meshes posts none. */
  private sentMeshes = new Map<SceneMesh, number>();
  private meshIds = 0;
  /** Posting is serialised: a bake's meshes stream over several tasks, and the next bake waits for that. */
  private posting: Promise<void> = Promise.resolve();
  private disposing = false;
  private isTerminated = false;
  /** The worker failed for good: every later bake rejects with this. */
  private failure: PathTracerError | null = null;

  private constructor(
    private readonly worker: Worker,
    private readonly options: LightBakerOptions,
  ) {
    worker.addEventListener('message', (event: MessageEvent<BakeReply>) => this.receive(event.data));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.fail('WORKER_UNAVAILABLE', `the bake worker failed: ${event.message || 'it could not start'}`);
    });
  }

  /** Starts the bake worker; throws `PathTracerError` `WORKER_UNAVAILABLE` where module workers or OffscreenCanvas are missing. */
  static create(options: LightBakerOptions = {}): LightBaker {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new PathTracerError('WORKER_UNAVAILABLE', 'the light bake needs module workers and OffscreenCanvas');
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./bake/bakeWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      throw new PathTracerError('WORKER_UNAVAILABLE', `the bake worker could not start: ${String(error)}`);
    }
    return new LightBaker(worker, options);
  }

  /** `dispose()` finished: the worker released everything and was terminated. */
  get terminated(): boolean {
    return this.isTerminated;
  }

  /**
   * Bakes `doc`. Validates it here first (`PathTracerError` `INVALID_SCENE`) and the options (`RangeError`); the worker
   * rejects with `SCENE_TOO_LARGE` over a limit and with `WEBGL2_UNAVAILABLE`, `FLOAT_TARGETS_UNAVAILABLE` or
   * `HIGHP_UNAVAILABLE` where its context cannot bake. A later `bake` or `dispose` supersedes a pending one, which then
   * resolves with `applied: false` after the tile in progress. Only what the worker does not hold is posted: texture
   * bytes when `doc.textures` is not the array the previous call posted, meshes it has not streamed before (a new pose
   * or option posts none). Both are compared by object, not by content: a mesh or textures array changed in place is
   * not posted again, so a changed mesh must be a new `SceneMesh` object (as `poseScene` and the loaders make them). New meshes stream as transferred byte chunks over several tasks, so the main thread never
   * clones a whole model at once; when the worker lost track of them it asks, and everything is posted again. The
   * call itself only checks the options and validates the document (`validateScene`). After the worker failed
   * (`WORKER_UNAVAILABLE`) every bake rejects with that error; after `dispose()` it resolves `applied: false`.
   */
  bake(doc: SceneDocument, options: BakeOptions = {}): Promise<BakeResult> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.disposing) return Promise.resolve(NOT_APPLIED);
    let parameters: BakeParameters;
    try {
      parameters = this.parameters(doc, options);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise<BakeResult>((resolve, reject) => {
      this.pending.set(parameters.id, {
        doc,
        parameters,
        samples: parameters.samples,
        onProgress: options.onProgress,
        resolve,
        reject,
      });
      this.enqueue(parameters.id);
    });
  }

  private enqueue(id: number): void {
    this.posting = this.posting
      .then(() => this.post(id))
      .catch((error: unknown) => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.reject(error);
      });
  }

  /** Posts a bake: the meshes the worker lacks, then the request naming every mesh; abandons a superseded one. */
  private async post(id: number): Promise<void> {
    // Nothing of the posting runs in the caller's task.
    await nextTask();
    const pending = this.pending.get(id);
    if (!pending) return;
    const current = () => id === this.latest && !this.disposing;
    const abandon = () => {
      this.pending.delete(id);
      pending.resolve(NOT_APPLIED);
    };
    if (!current()) return abandon();
    const { doc } = pending;
    const ids: number[] = [];
    const named = new Map<SceneMesh, number>();
    const fresh: [number, SceneMesh][] = [];
    for (const mesh of doc.meshes) {
      let meshId = named.get(mesh) ?? this.sentMeshes.get(mesh);
      if (meshId === undefined) {
        meshId = ++this.meshIds;
        fresh.push([meshId, mesh]);
      }
      named.set(mesh, meshId);
      ids.push(meshId);
    }
    if (fresh.length > 0) {
      const post = (message: BakeRequest, transfer: Transferable[] = []) => this.worker.postMessage(message, transfer);
      if (!(await streamMeshes(post, fresh, current, nextTask))) return abandon();
    }
    if (!current()) return abandon();
    // The worker keeps the meshes this bake names, whatever becomes of the bake.
    this.sentMeshes = named;
    const texturesIncluded = doc.textures !== this.sentTextures;
    if (texturesIncluded) {
      this.sentTextures = doc.textures;
      this.texturesVersion++;
    }
    const textures = texturesIncluded ? doc.textures : doc.textures.map((texture) => ({ ...texture, bytes: null }));
    const request: BakeRequest = {
      ...pending.parameters,
      doc: { ...doc, meshes: [], textures },
      meshIds: ids,
      texturesVersion: this.texturesVersion,
      texturesIncluded,
    };
    this.worker.postMessage(request);
  }

  private parameters(doc: SceneDocument, options: BakeOptions): BakeParameters {
    if (options.countCappedTraversals && !this.options.testHooks) {
      throw new Error('countCappedTraversals is a test hook: create the baker with testHooks: true');
    }
    const samples = checkInteger('samples', options.samples ?? DEFAULT_BAKE_SAMPLES, 1, MAX_BAKE_SAMPLES);
    const seed = checkInteger('seed', options.seed ?? 1, 0, MAX_SEED);
    const tileSize = checkInteger('tileSize', options.tileSize ?? DEFAULT_BAKE_TILE, 16, 512);
    try {
      validateScene(doc);
    } catch (error) {
      if (error instanceof RendererError) {
        throw new PathTracerError('INVALID_SCENE', error.message.replace(/ \(at [^)]*\)$/, ''), error.path);
      }
      throw error;
    }
    return {
      type: 'bake',
      id: ++this.latest,
      seed,
      samples,
      shadowCatcher: options.shadowCatcher ?? true,
      tileSize,
      maxTriangles: this.options.maxTriangles ?? DEFAULT_MAX_TRIANGLES,
      countCapped: options.countCappedTraversals === true,
    };
  }

  /**
   * Test hook (`testHooks: true`): the worker loses its context and gets it back; a running bake restarts. With
   * `beforeMark` the loss comes right before the readback after that many samples of a running bake; with
   * `failRestore` the restored context cannot bake (pending and later bakes reject).
   */
  loseContext(options: { readonly beforeMark?: number; readonly failRestore?: boolean } = {}): void {
    if (!this.options.testHooks) throw new Error('loseContext is a test hook: create the baker with testHooks: true');
    const request: BakeRequest = {
      type: 'loseContext',
      ...(options.beforeMark !== undefined ? { beforeMark: options.beforeMark } : {}),
      ...(options.failRestore ? { failRestore: true } : {}),
    };
    if (!this.disposing) this.worker.postMessage(request);
  }

  /** Supersedes a pending bake; the worker releases its GL objects and images and is terminated. */
  dispose(): void {
    if (this.disposing) return;
    this.disposing = true;
    this.worker.postMessage({ type: 'dispose' } satisfies BakeRequest);
  }

  private receive(reply: BakeReply): void {
    if (reply.type === 'disposed') {
      this.terminate();
      return;
    }
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    const current = reply.id === this.latest && !this.disposing;
    switch (reply.type) {
      case 'progress':
        if (current) {
          pending.onProgress?.({
            samplesDone: reply.lighting.samples,
            samples: pending.samples,
            lighting: reply.lighting,
          });
        }
        return;
      case 'restarted':
        return;
      case 'resend': {
        if (!current) {
          this.pending.delete(reply.id);
          pending.resolve(NOT_APPLIED);
          return;
        }
        // The worker lost track of what it was sent (an abandoned stream, a failed bake): post everything again.
        this.sentTextures = null;
        this.sentMeshes = new Map();
        this.enqueue(reply.id);
        return;
      }
      case 'done':
        this.pending.delete(reply.id);
        pending.resolve(current ? { applied: true, warnings: reply.warnings, lighting: reply.lighting } : NOT_APPLIED);
        return;
      case 'stopped':
        this.pending.delete(reply.id);
        pending.resolve(NOT_APPLIED);
        return;
      case 'error': {
        this.pending.delete(reply.id);
        if (!current) {
          pending.resolve(NOT_APPLIED);
          return;
        }
        const error =
          reply.name === 'PathTracerError'
            ? new PathTracerError(reply.code as PathTracerErrorCode, reply.message, reply.path)
            : reply.name === 'RangeError'
              ? new RangeError(reply.message)
              : new Error(reply.message);
        pending.reject(error);
      }
    }
  }

  private fail(code: PathTracerErrorCode, message: string): void {
    this.failure = new PathTracerError(code, message);
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    this.terminate();
  }

  private terminate(): void {
    for (const pending of this.pending.values()) pending.resolve(NOT_APPLIED);
    this.pending.clear();
    this.disposing = true;
    this.worker.terminate();
    this.isTerminated = true;
  }
}
