import { MeshAssembler } from '../bake/meshStream';
import { PathTracerError } from '../PathTracerError';
import type { GeometryReply, GeometryRequest } from './geometryMessages';
import { prepareGeometry, preparedTransfer } from './prepareGeometry';

/** The geometry worker without its global scope: rebuilds the streamed meshes and prepares one request at a time. */
export class GeometryWorkerCore {
  private readonly meshes = new MeshAssembler();

  constructor(private readonly post: (reply: GeometryReply, transfer?: Transferable[]) => void) {}

  receive(request: GeometryRequest): void {
    if (request.type !== 'prepare') {
      this.meshes.receive(request);
      return;
    }
    const { id } = request;
    const meshes = this.meshes.take(request.meshIds);
    if (!meshes) {
      this.post({ type: 'resend', id });
      return;
    }
    try {
      const prepared = prepareGeometry({ ...request.doc, meshes }, request.params);
      this.post({ type: 'prepared', id, prepared }, preparedTransfer(prepared));
    } catch (error) {
      this.post(errorReply(id, error));
    }
  }
}

function errorReply(id: number, error: unknown): GeometryReply {
  if (error instanceof PathTracerError) {
    const suffix = error.path ? ` (at ${error.path})` : '';
    const message = suffix && error.message.endsWith(suffix) ? error.message.slice(0, -suffix.length) : error.message;
    return { type: 'error', id, name: error.name, code: error.code, message, path: error.path };
  }
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  return { type: 'error', id, name, code: '', message, path: '' };
}
