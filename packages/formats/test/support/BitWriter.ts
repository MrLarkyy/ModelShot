/** Writes deflate's bit stream: values least significant bit first, Huffman codes most significant bit first. */
export class BitWriter {
  private readonly bytes: number[] = [];
  private buffer = 0;
  private count = 0;

  constructor(header: readonly number[] = [0x78, 0x01]) {
    this.bytes.push(...header);
  }

  bits(value: number, count: number): this {
    for (let i = 0; i < count; i++) this.bit((value >> i) & 1);
    return this;
  }

  code(code: number, length: number): this {
    for (let i = length - 1; i >= 0; i--) this.bit((code >> i) & 1);
    return this;
  }

  /** Pads to a byte boundary and appends raw bytes. */
  raw(bytes: readonly number[]): this {
    this.flush();
    for (const byte of bytes) this.bytes.push(byte);
    return this;
  }

  done(): Uint8Array {
    this.flush();
    return Uint8Array.from(this.bytes);
  }

  private bit(bit: number): void {
    this.buffer |= bit << this.count;
    if (++this.count === 8) this.flush();
  }

  private flush(): void {
    if (this.count === 0) return;
    this.bytes.push(this.buffer);
    this.buffer = 0;
    this.count = 0;
  }
}
