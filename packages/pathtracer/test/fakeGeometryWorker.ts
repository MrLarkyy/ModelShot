import type { GeometryReply, GeometryRequest } from '../src/geometry/geometryMessages';
import { GeometryWorkerCore } from '../src/geometry/GeometryWorkerCore';

/**
 * A `Worker` stand-in running `GeometryWorkerCore` one task later, every message passed through `structuredClone` with
 * its transfer list both ways, as a real worker's are. `holdReplies` keeps replies in `held` until `release`.
 */
export class FakeGeometryWorker {
  static last: FakeGeometryWorker | null = null;
  readonly posted: { readonly message: GeometryRequest; readonly transfer: readonly Transferable[] }[] = [];
  readonly replies: { readonly reply: GeometryReply; readonly transfer: readonly Transferable[] }[] = [];
  held: GeometryReply[] = [];
  holdReplies = false;
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  private readonly core = new GeometryWorkerCore((reply, transfer = []) => {
    this.replies.push({ reply, transfer });
    const copy = structuredClone(reply, { transfer });
    if (this.holdReplies) this.held.push(copy);
    else setTimeout(() => this.deliver(copy), 0);
  });

  constructor() {
    FakeGeometryWorker.last = this;
  }

  postMessage(message: GeometryRequest, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
    const copy = structuredClone(message, { transfer });
    setTimeout(() => {
      if (!this.terminated) this.core.receive(copy);
    }, 0);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Delivers the held replies (or `replies` given) in order. */
  release(replies: readonly GeometryReply[] = this.held): void {
    const list = [...replies];
    this.held = this.held.filter((reply) => !list.includes(reply));
    for (const reply of list) this.deliver(reply);
  }

  deliver(data: GeometryReply): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }

  fail(): void {
    for (const listener of this.listeners.get('error') ?? []) listener({ message: 'boom', preventDefault: () => {} });
  }

  /** Messages of `type` posted so far. */
  ofType<T extends GeometryRequest['type']>(type: T): Extract<GeometryRequest, { type: T }>[] {
    return this.posted.flatMap(({ message }) =>
      message.type === type ? [message as Extract<GeometryRequest, { type: T }>] : [],
    );
  }
}

/** Resolves once `done()` holds, checking after each timer turn; throws when it does not within `turns`. */
export async function until(done: () => boolean, turns = 1000): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition not reached');
}
