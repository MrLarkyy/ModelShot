import { describe, expect, it } from 'vitest';
import { effectiveModelFormat } from '../../src/bbmodel/effectiveModelFormat';
import { loadBbmodel } from '../../src/index';
import { cube, model, pngDataUri } from './fixtures';

/** A model whose `meta` has no `model_format` unless `meta` gives one; texture 0 is a 16×64 strip with `fps` 20, `frame_time` 4. */
function load(meta: Record<string, unknown>) {
  const face = { uv: [0, 0, 16, 16], texture: 1 };
  return loadBbmodel(
    JSON.stringify(
      model({
        meta: { format_version: '4.5', box_uv: false, ...meta },
        elements: [cube({ faces: { north: face } })],
        textures: [
          { name: 'strip', source: pngDataUri(16, 64), fps: 20, frame_time: 4 },
          { name: 'other', source: pngDataUri(16, 16) },
        ],
      }),
    ),
  );
}

describe('a missing model_format (Blockbench processCompatibility)', () => {
  it.each([
    [{}],
    [{ model_format: '' }],
    [{ model_format: null }],
    [{ model_format: false }],
    [{ model_format: 0 }],
    [{ bone_rig: false }],
  ])('%j reads as java_block', (meta) => {
    const { scene, warnings } = load(meta);
    expect(warnings).toEqual([]);
    expect(scene.textures[0]?.frames?.count).toBe(4);
    expect(scene.textures[0]?.frames?.frameTime).toBeCloseTo(0.2);
    expect(scene.meshes[0]?.groups.map((g) => [g.material, g.doubleSided])).toEqual([[1, false]]);
    expect(scene.source.modelFormat).toBe('unknown');
  });

  it.each([[{ bone_rig: true }], [{ model_format: '', bone_rig: true }], [{ model_format: null, bone_rig: true }]])(
    '%j reads as bedrock_old',
    (meta) => {
      const { scene } = load(meta);
      expect(scene.textures[0]?.frames?.frameTime).toBeCloseTo(0.05);
      expect(scene.meshes[0]?.groups.map((g) => [g.material, g.doubleSided])).toEqual([[0, true]]);
      expect(scene.source.modelFormat).toBe('unknown');
    },
  );

  it('a truthy model_format that is no string still fails the load', () => {
    expect(() => load({ model_format: 5 })).toThrow(/model_format/);
  });

  it('a declared format wins over bone_rig and is kept in the source', () => {
    const { scene } = load({ model_format: 'free', bone_rig: true });
    expect(scene.source.modelFormat).toBe('free');
    expect(scene.meshes[0]?.groups.map((g) => g.material)).toEqual([1]);
  });

  it('bone_rig follows JavaScript truthiness', () => {
    expect(effectiveModelFormat({ bone_rig: 1 }, '')).toBe('bedrock_old');
    expect(effectiveModelFormat({ bone_rig: 0 }, '')).toBe('java_block');
    expect(effectiveModelFormat({ bone_rig: 'x' }, '')).toBe('bedrock_old');
    expect(effectiveModelFormat({ bone_rig: null }, '')).toBe('java_block');
  });
});
