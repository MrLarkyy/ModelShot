/** "1.25 s of 2.00 s": the playhead and the clip length for the scrubber's spoken value. */
export function describeTime(time: number, length: number): string {
  return `${time.toFixed(2)} s of ${length.toFixed(2)} s`;
}

/** "1.25 / 2.00 s": the same two numbers as `describeTime`, short for the transport bar. */
export function readoutText(time: number, length: number): string {
  return `${time.toFixed(2)} / ${length.toFixed(2)} s`;
}
