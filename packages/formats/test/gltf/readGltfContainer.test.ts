import { describe, expect, it } from 'vitest';
import { GltfError, loadGltf } from '../../src/index';
import { readGltfContainer } from '../../src/gltf/readGltfContainer';
import { expectGltfError, json } from './expectGltfError';
import { gltfDoc, toGlb } from './gltfBuilder';

const LIMIT = 1 << 20;

function withHeader(glb: Uint8Array, change: (view: DataView) => void): Uint8Array {
  const copy = new Uint8Array(glb);
  change(new DataView(copy.buffer));
  return copy;
}

describe('readGltfContainer', () => {
  it('reads a GLB: JSON chunk, BIN chunk, version', () => {
    const container = readGltfContainer(toGlb(gltfDoc()), LIMIT);
    expect(container.kind).toBe('glb');
    expect(container.version).toBe('2.0');
    expect(container.bin?.byteLength).toBeGreaterThan(0);
  });

  it('reads .gltf text and bytes, with or without a byte-order mark', () => {
    const text = json(gltfDoc());
    for (const input of [text, `\uFEFF${text}`, new TextEncoder().encode(`\uFEFF${text}`)]) {
      const container = readGltfContainer(input, LIMIT);
      expect(container.kind).toBe('gltf');
      expect(container.bin).toBeNull();
    }
  });

  it('skips chunks of unknown type after the JSON chunk', () => {
    const glb = toGlb(gltfDoc());
    const extra = new Uint8Array(glb.byteLength + 12);
    extra.set(glb);
    const view = new DataView(extra.buffer);
    view.setUint32(8, extra.byteLength, true);
    view.setUint32(glb.byteLength, 4, true);
    view.setUint32(glb.byteLength + 4, 0x12345678, true);
    expect(loadGltf(extra).scene.meshes).toHaveLength(1);
  });

  it('rejects broken headers and chunks with the byte offset', () => {
    const glb = toGlb(gltfDoc());
    expectGltfError(glb.slice(0, 8), 'NOT_GLB', 'glb[0]');
    expectGltfError(
      withHeader(glb, (v) => v.setUint32(4, 1, true)),
      'UNSUPPORTED_VERSION',
      'glb[4]',
    );
    expectGltfError(
      withHeader(glb, (v) => v.setUint32(8, glb.byteLength + 4, true)),
      'NOT_GLB',
      'glb[8]',
    );
    expectGltfError(
      withHeader(glb, (v) => v.setUint32(8, 16, true)),
      'NOT_GLB',
      'glb[8]',
    );
    expectGltfError(
      withHeader(glb, (v) => v.setUint32(12, 6, true)),
      'NOT_GLB',
      'glb[12]',
    );
    expectGltfError(
      withHeader(glb, (v) => v.setUint32(16, 0x004e4942, true)),
      'NOT_GLB',
      'glb[16]',
    );
  });

  it('rejects invalid UTF-8, non-JSON and non-glTF JSON', () => {
    expectGltfError(new Uint8Array([0x7b, 0xff, 0x7d]), 'NOT_JSON', '$');
    expectGltfError('{"asset":', 'NOT_JSON', '$');
    expectGltfError('[1, 2]', 'NOT_GLTF', '$');
    expectGltfError('{}', 'NOT_GLTF', '$.asset');
    expectGltfError(json({ asset: {} }), 'NOT_GLTF', '$.asset.version');
    expectGltfError(json({ asset: { version: 2 } }), 'INVALID_FIELD', '$.asset.version');
  });

  it('accepts 2.x and a minVersion up to 2.0 only', () => {
    expect(readGltfContainer(json({ asset: { version: '2.1' } }), LIMIT).version).toBe('2.1');
    expect(readGltfContainer(json({ asset: { version: '2.0', minVersion: '2.0' } }), LIMIT).version).toBe('2.0');
    expectGltfError(json({ asset: { version: '1.0' } }), 'UNSUPPORTED_VERSION', '$.asset.version');
    expectGltfError(json({ asset: { version: '3.0' } }), 'UNSUPPORTED_VERSION', '$.asset.version');
    expectGltfError(json({ asset: { version: '2' } }), 'UNSUPPORTED_VERSION', '$.asset.version');
    expectGltfError(
      json({ asset: { version: '2.0', minVersion: '2.1' } }),
      'UNSUPPORTED_VERSION',
      '$.asset.minVersion',
    );
  });

  it('every truncation of a small GLB ends in a GltfError', () => {
    const glb = toGlb(gltfDoc());
    for (let length = 0; length < glb.byteLength; length++) {
      expect(() => loadGltf(glb.slice(0, length)), `length ${length}`).toThrow(GltfError);
    }
  });

  it('every single-byte flip of its 20-byte header ends in a GltfError', () => {
    const glb = toGlb(gltfDoc());
    for (let at = 0; at < 20; at++) {
      for (const mask of [0x01, 0x80, 0xff]) {
        const flipped = new Uint8Array(glb);
        flipped[at] = (flipped[at] ?? 0) ^ mask;
        expect(() => loadGltf(flipped), `byte ${at} ^ ${mask}`).toThrow(GltfError);
      }
    }
  });
});
