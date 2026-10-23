import { describe, expect, it } from 'vitest';
import { collectTransferables } from '../src/intake/collectTransferables';

describe('collectTransferables', () => {
  it('lists each buffer once, also when views share it', () => {
    const shared = new ArrayBuffer(16);
    const doc = {
      meshes: [{ positions: new Float32Array(shared, 0, 2), uvs: new Float32Array(shared, 8, 2) }],
      textures: [{ bytes: new Uint8Array(4), name: 'x' }, { bytes: null }],
    };
    const list = collectTransferables(doc);
    expect(list).toHaveLength(2);
    expect(list).toContain(shared);
  });

  it('stops at a bounded depth and ignores non-objects', () => {
    expect(collectTransferables(null)).toEqual([]);
    expect(collectTransferables('text')).toEqual([]);
    const deep = { a: { b: { c: { d: { e: { f: new Uint8Array(1) } } } } } };
    expect(collectTransferables(deep)).toEqual([]);
  });
});
