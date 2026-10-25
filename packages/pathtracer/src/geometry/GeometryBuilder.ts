import type { SceneDocument, SceneMesh } from '@modelshot/scene';
import { streamMeshes } from '../bake/meshStream';
import { nextTask } from '../nextTask';
import { PathTracerError, type PathTracerErrorCode } from '../PathTracerError';
import type { GeometryReply, GeometryRequest } from './geometryMessages';
import { prepareGeometry, type GeometryParams, type PreparedGeometry } from './prepareGeometry';

interface Pending {
  readonly doc: SceneDocument;
  readonly params: GeometryParams;
  readonly resolve: (prepared: PreparedGeometry | null) => void;
  readonly reject: (error: unknown) => void;
}

/** The interface of a `Worker` the builder uses. */
type GeometryWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;

const noop = (): void => undefined;

function rebuildError(reply: Extract<GeometryReply, { type: 'error' }>): Error {
  if (reply.name === 'PathTracerError') {
    return new PathTracerError(reply.code as PathTracerErrorCode, reply.message, reply.path);
  }
  return reply.name === 'RangeError' ? new RangeError(reply.message) : new Error(reply.message);
}

/**
 * Prepares a scene's geometry (`prepareGeometry`: flatten, BVH, pack, bounds) in a module Worker, so the main thread
 * only streams the meshes in transferred chunks over several tasks and takes the packed buffers back by transfer.
 * Without Worker support, when the worker cannot start or once it failed, every build (the pending ones again, in call
 * order) runs on the calling thread instead: the same function, so the same bytes. Builds settle in call order.
 */
export class GeometryBuilder {
  private readonly pending = new Map<number, Pending>();
  private ids = 0;
  /** Meshes the worker holds, by the ids they were streamed under; a later build of the same meshes posts none. */
  private sentMeshes = new Map<SceneMesh, number>();
  private meshIds = 0;
  /** Posting is serialised: a build's meshes stream over several tasks, and the next build waits for that. */
  private posting: Promise<void> = Promise.resolve();
  /** Settles after every build so far: each build's result waits for the earlier ones. */
  private settled: Promise<void> = Promise.resolve();
  private disposed = false;

  private constructor(private worker: GeometryWorker | null) {
    if (!worker) return;
    worker.addEventListener('message', (event) => this.receive((event as MessageEvent<GeometryReply>).data));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.fallBack();
    });
    worker.addEventListener('messageerror', () => this.fallBack());
  }

  /** A builder with its worker when `useWorker` and the browser can start one, else one that builds inline. */
  static create(useWorker: boolean): GeometryBuilder {
    if (!useWorker || typeof Worker === 'undefined') return new GeometryBuilder(null);
    try {
      return new GeometryBuilder(new Worker(new URL('./geometryWorker.ts', import.meta.url), { type: 'module' }));
    } catch {
      return new GeometryBuilder(null);
    }
  }

  /** Builds run in the worker (until it fails). */
  get inWorker(): boolean {
    return this.worker !== null;
  }

  /**
   * The prepared geometry of `doc` (validated by the caller), or `null` when `dispose()` came first. Rejects as
   * `prepareGeometry` throws (`SCENE_TOO_LARGE`). Inline, the work runs within this call.
   */
  build(doc: SceneDocument, params: GeometryParams): Promise<PreparedGeometry | null> {
    if (this.disposed) return Promise.resolve(null);
    const own = new Promise<PreparedGeometry | null>((resolve, reject) => {
      if (!this.worker) {
        runInline(doc, params, resolve, reject);
        return;
      }
      const id = ++this.ids;
      this.pending.set(id, { doc, params, resolve, reject });
      this.enqueue(id);
    });
    const ordered = this.settled.then(() => own);
    this.settled = ordered.then(noop, noop);
    return ordered;
  }

  /** Terminates the worker; pending builds resolve `null` and a late reply is ignored. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.resolve(null);
    this.pending.clear();
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

  /** Posts a build: the meshes the worker lacks, then the request naming every mesh. */
  private async post(id: number): Promise<void> {
    // Nothing of the posting runs in the caller's task.
    await nextTask();
    const pending = this.pending.get(id);
    const worker = this.worker;
    if (!pending || !worker) return;
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
    const live = () => this.worker === worker && this.pending.has(id);
    if (fresh.length > 0) {
      const post = (message: GeometryRequest, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
      if (!(await streamMeshes(post, fresh, live, nextTask))) return;
    }
    if (!live()) return;
    // The worker keeps the meshes this build names, whatever becomes of the build.
    this.sentMeshes = named;
    const request: GeometryRequest = {
      type: 'prepare',
      id,
      doc: {
        formatVersion: doc.formatVersion,
        source: doc.source,
        nodes: doc.nodes,
        rootNodes: doc.rootNodes,
        meshes: [],
        materials: [],
        textures: [],
      },
      meshIds: ids,
      params: pending.params,
    };
    worker.postMessage(request);
  }

  private receive(reply: GeometryReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending || this.disposed) return;
    if (reply.type === 'resend') {
      // The worker lost track of what it was sent: post everything again.
      this.sentMeshes = new Map();
      this.enqueue(reply.id);
      return;
    }
    this.pending.delete(reply.id);
    if (reply.type === 'prepared') pending.resolve(reply.prepared);
    else pending.reject(rebuildError(reply));
  }

  /** The worker failed (it could not load, threw, or a reply could not be read): inline from now on, pending too. */
  private fallBack(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.sentMeshes = new Map();
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const { doc, params, resolve, reject } of pending) runInline(doc, params, resolve, reject);
  }
}

function runInline(
  doc: SceneDocument,
  params: GeometryParams,
  resolve: (prepared: PreparedGeometry) => void,
  reject: (error: unknown) => void,
): void {
  try {
    resolve(prepareGeometry(doc, params));
  } catch (error) {
    reject(error);
  }
}
