import { describe, expect, it } from 'vitest';
import { ACCEPTED_MODEL_EXTENSIONS, ACCEPTED_RESOURCE_EXTENSIONS, detectModelFormat } from '../src/index';

describe('detectModelFormat', () => {
  it('accepts exactly bbmodel, gltf, glb and obj models, and bin, png and mtl resources', () => {
    expect([...ACCEPTED_MODEL_EXTENSIONS]).toEqual(['.bbmodel', '.gltf', '.glb', '.obj']);
    expect([...ACCEPTED_RESOURCE_EXTENSIONS]).toEqual(['.bin', '.png', '.mtl']);
  });

  it('goes by the extension, case-insensitively', () => {
    expect(detectModelFormat('robot.bbmodel')).toBe('bbmodel');
    expect(detectModelFormat('Robot.GLTF')).toBe('gltf');
    expect(detectModelFormat('a.b.glb')).toBe('glb');
    expect(detectModelFormat('crate.Obj')).toBe('obj');
    for (const name of ['crate.mtl', 'crate.fbx', 'crate', '.obj.txt', 'obj', 'toString', '__proto__']) {
      expect(detectModelFormat(name), name).toBeNull();
    }
  });

  it('a GLB header wins over the name', () => {
    const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
    expect(detectModelFormat('model.gltf', glb)).toBe('glb');
    expect(detectModelFormat('download', glb)).toBe('glb');
    expect(detectModelFormat('model.gltf', new Uint8Array([0x7b]))).toBe('gltf');
    expect(detectModelFormat('x.obj', new Uint8Array([0x67, 0x6c]))).toBe('obj');
  });
});
