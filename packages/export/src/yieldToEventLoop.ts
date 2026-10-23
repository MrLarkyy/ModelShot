/**
 * Resolves after the event loop ran other tasks (input, rendering). A message rather than a timer: nested timers are
 * clamped to 4 ms each, which a clip of many thousand steps would spend waiting.
 */
export function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
