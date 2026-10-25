import type { GeometryReply, GeometryRequest } from './geometryMessages';
import { GeometryWorkerCore } from './GeometryWorkerCore';

interface WorkerScope {
  postMessage(message: GeometryReply, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<GeometryRequest>) => void): void;
}

const scope = globalThis as unknown as WorkerScope;
const core = new GeometryWorkerCore((reply, transfer = []) => scope.postMessage(reply, transfer));
scope.addEventListener('message', (event) => core.receive(event.data));
