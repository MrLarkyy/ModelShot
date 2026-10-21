import type { SceneMesh } from '@modelshot/scene';

/** Bytes of mesh data per transferred chunk. */
export const MESH_CHUNK_BYTES = 1024 * 1024;
/** Bytes copied on the main thread before it yields to other tasks. */
export const MESH_TASK_BYTES = 2 * 1024 * 1024;
/** Mesh headers per message. */
const HEADERS_PER_MESSAGE = 512;

/** The arrays of a mesh in stream order, with their element types. */
const FIELDS = ['positions', 'normals', 'uvs', 'uvRects', 'indices'] as const;

/** A mesh without its arrays, and their lengths in elements (stream order of `FIELDS`). */
export interface MeshHeader {
  readonly id: number;
  readonly name: string;
  readonly sourceId: string;
  readonly node: number;
  readonly visible: boolean;
  readonly renderOrder?: number;
  readonly groups: SceneMesh['groups'];
  readonly lengths: readonly number[];
}

/** Main thread to bake worker: new meshes, streamed before the bake that names them. */
export type MeshMessage =
  /** A new stream: whatever an earlier, abandoned stream left half done is dropped. */
  | { readonly type: 'meshBegin' }
  | { readonly type: 'meshHeaders'; readonly headers: readonly MeshHeader[] }
  /** The next bytes of the arrays, in header order and `FIELDS` order within a mesh. */
  | { readonly type: 'meshData'; readonly bytes: Uint8Array };

function header(id: number, mesh: SceneMesh): MeshHeader {
  return {
    id,
    name: mesh.name,
    sourceId: mesh.sourceId,
    node: mesh.node,
    visible: mesh.visible,
    ...(mesh.renderOrder !== undefined ? { renderOrder: mesh.renderOrder } : {}),
    groups: mesh.groups.map((group) => ({ ...group })),
    lengths: FIELDS.map((field) => mesh[field].length),
  };
}

const bytesOf = (array: Float32Array | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/**
 * Streams `meshes` to the worker: headers, then their array bytes copied into `MESH_CHUNK_BYTES` buffers that are
 * transferred, not cloned. After every `MESH_TASK_BYTES` it yields (`nextTask`), so a large model never blocks the main
 * thread for long, and stops when `current()` turns false (a later bake). Returns whether it finished.
 */
export async function streamMeshes(
  post: (message: MeshMessage, transfer?: Transferable[]) => void,
  meshes: readonly (readonly [number, SceneMesh])[],
  current: () => boolean,
  nextTask: () => Promise<void>,
): Promise<boolean> {
  post({ type: 'meshBegin' });
  for (let at = 0; at < meshes.length; at += HEADERS_PER_MESSAGE) {
    post({ type: 'meshHeaders', headers: meshes.slice(at, at + HEADERS_PER_MESSAGE).map(([id, m]) => header(id, m)) });
  }
  let chunk = new Uint8Array(MESH_CHUNK_BYTES);
  let used = 0;
  let sinceYield = 0;
  const flush = (): void => {
    if (used === 0) return;
    const bytes = used === chunk.length ? chunk : chunk.slice(0, used);
    post({ type: 'meshData', bytes }, [bytes.buffer]);
    chunk = new Uint8Array(MESH_CHUNK_BYTES);
    used = 0;
  };
  for (const [, mesh] of meshes) {
    for (const field of FIELDS) {
      const source = bytesOf(mesh[field]);
      for (let from = 0; from < source.length;) {
        const count = Math.min(source.length - from, chunk.length - used);
        chunk.set(source.subarray(from, from + count), used);
        used += count;
        from += count;
        sinceYield += count;
        if (used === chunk.length) flush();
        if (sinceYield >= MESH_TASK_BYTES) {
          sinceYield = 0;
          await nextTask();
          if (!current()) return false;
        }
      }
    }
  }
  flush();
  return true;
}

/** Worker side: rebuilds streamed meshes and keeps the ones the latest bake named. */
export class MeshAssembler {
  private held = new Map<number, SceneMesh>();
  private incoming = new Map<number, SceneMesh>();
  private pending: Uint8Array[] = [];
  private index = 0;
  private offset = 0;

  receive(message: MeshMessage): void {
    if (message.type === 'meshBegin') {
      this.incoming.clear();
      this.pending = [];
      this.index = 0;
      this.offset = 0;
    } else if (message.type === 'meshHeaders') {
      for (const h of message.headers) {
        const floats = (i: number) => new Float32Array(h.lengths[i] ?? 0);
        const mesh: SceneMesh = {
          name: h.name,
          sourceId: h.sourceId,
          node: h.node,
          visible: h.visible,
          ...(h.renderOrder !== undefined ? { renderOrder: h.renderOrder } : {}),
          positions: floats(0),
          normals: floats(1),
          uvs: floats(2),
          uvRects: floats(3),
          indices: new Uint32Array(h.lengths[4] ?? 0),
          groups: h.groups,
        };
        this.incoming.set(h.id, mesh);
        for (const field of FIELDS) if (mesh[field].length > 0) this.pending.push(bytesOf(mesh[field]));
      }
    } else {
      let from = 0;
      const bytes = message.bytes;
      while (from < bytes.length && this.index < this.pending.length) {
        const target = this.pending[this.index] as Uint8Array;
        const count = Math.min(bytes.length - from, target.length - this.offset);
        target.set(bytes.subarray(from, from + count), this.offset);
        from += count;
        this.offset += count;
        if (this.offset === target.length) {
          this.index++;
          this.offset = 0;
        }
      }
    }
  }

  /**
   * The meshes of `ids`, from this stream or held from earlier bakes; they become the held ones. `null` when one is
   * unknown or not complete (an abandoned or failed stream): the main thread has to post the meshes again.
   */
  take(ids: readonly number[]): SceneMesh[] | null {
    if (this.index < this.pending.length) return null;
    const meshes: SceneMesh[] = [];
    for (const id of ids) {
      const mesh = this.incoming.get(id) ?? this.held.get(id);
      if (!mesh) return null;
      meshes.push(mesh);
    }
    this.held = new Map(ids.map((id, i) => [id, meshes[i] as SceneMesh]));
    this.incoming.clear();
    return meshes;
  }
}
