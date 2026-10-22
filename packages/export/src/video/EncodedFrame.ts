/** One encoded video frame as WebCodecs hands it out, copied. */
export interface EncodedFrame {
  readonly data: Uint8Array<ArrayBuffer>;
  /** Presentation time in microseconds. */
  readonly timestamp: number;
  readonly key: boolean;
}
