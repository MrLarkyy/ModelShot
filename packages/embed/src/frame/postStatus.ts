export type EmbedStatus =
  { readonly type: 'load' } | { readonly type: 'error'; readonly code: string; readonly message: string };

/** The parts of a window the status goes to (a test passes a fake). */
export interface StatusTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * Tells the embedding page that the model is shown or why not: `{ source: 'modelshot-embed', v: 1, type, code?,
 * message? }` (docs/embed.md, Events). To any origin, since the frame does not know its host; it holds no model data.
 * Nothing is sent when the frame is not embedded (`parent` is the frame itself).
 */
export function postStatus(parent: StatusTarget, self: StatusTarget, status: EmbedStatus): void {
  if (parent === self) return;
  parent.postMessage({ source: 'modelshot-embed', v: 1, ...status }, '*');
}
