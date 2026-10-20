export function assertSampleCount(expected: number, drawn: number): void {
  if (drawn !== expected) {
    throw new Error(`fixture accumulated ${drawn} samples, the spec asks for ${expected}`);
  }
}
