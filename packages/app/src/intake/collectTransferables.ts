const MAX_DEPTH = 4;

// The ArrayBuffers behind the typed arrays of a loaded document, each once, so posting it moves the geometry and
// the texture bytes instead of copying them (a shared buffer listed twice would make the post throw).
export function collectTransferables(root: unknown): ArrayBuffer[] {
  const found = new Set<ArrayBuffer>();
  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null || depth > MAX_DEPTH) return;
    if (ArrayBuffer.isView(value)) {
      if (value.buffer instanceof ArrayBuffer) found.add(value.buffer);
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(root, 0);
  return [...found];
}
