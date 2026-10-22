/** A growing byte buffer for container headers: big- and little-endian integers, ASCII and raw bytes. */
export class ByteWriter {
  private buffer = new Uint8Array(64);
  private view = new DataView(this.buffer.buffer);
  private length = 0;

  get size(): number {
    return this.length;
  }

  u8(value: number): this {
    this.reserve(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
    return this;
  }

  u16(value: number, littleEndian = false): this {
    this.reserve(2);
    this.view.setUint16(this.length, value, littleEndian);
    this.length += 2;
    return this;
  }

  u24(value: number, littleEndian = false): this {
    const bytes = [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    for (const byte of littleEndian ? bytes.reverse() : bytes) this.u8(byte);
    return this;
  }

  u32(value: number, littleEndian = false): this {
    this.reserve(4);
    this.view.setUint32(this.length, value >>> 0, littleEndian);
    this.length += 4;
    return this;
  }

  i16(value: number, littleEndian = false): this {
    this.reserve(2);
    this.view.setInt16(this.length, value, littleEndian);
    this.length += 2;
    return this;
  }

  f64(value: number): this {
    this.reserve(8);
    this.view.setFloat64(this.length, value);
    this.length += 8;
    return this;
  }

  ascii(text: string): this {
    for (let i = 0; i < text.length; i++) this.u8(text.charCodeAt(i) & 0x7f);
    return this;
  }

  bytes(data: Uint8Array): this {
    this.reserve(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
    return this;
  }

  /** The bytes written so far, a copy. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.length);
  }

  private reserve(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }
}
