import { describe, expect, it } from 'vitest';
import { loadBbmodel, type BbmodelLimits } from '../../src/index';
import { cube, model } from './fixtures';

const json = (value: unknown): string => JSON.stringify(value);
const meta = (modelFormat: string, extra: Record<string, unknown> = {}) => ({
  format_version: '4.5',
  model_format: modelFormat,
  ...extra,
});

/** North-face uv rect of the first mesh, in uv units of `width` × `height`. */
function northRect(text: string, width: number, height: number): number[] {
  const rects = loadBbmodel(text).scene.meshes[0]?.uvRects ?? new Float32Array(4);
  return [...rects.slice(0, 4)].map((x, k) => x * (k % 2 ? height : width));
}

describe('per-texture UV size (Blockbench per_texture_uv_size)', () => {
  const textures = [{ name: 't', uv_width: 32, uv_height: 64 }];

  it('applies uv_width/uv_height in the free format', () => {
    const { scene } = loadBbmodel(json(model({ meta: meta('free'), textures })));
    expect(scene.textures[0]).toMatchObject({ uvWidth: 32, uvHeight: 64 });
  });

  it.each(['bedrock', 'java_block', 'modded_entity', 'unknown-format'])(
    'uses the project resolution in %s and ignores the per-texture fields',
    (format) => {
      const ignored = [{ name: 't', uv_width: 0, uv_height: 'x' }];
      const { scene } = loadBbmodel(
        json(model({ meta: meta(format), textures: ignored, resolution: { width: 64, height: 32 } })),
      );
      expect(scene.textures[0]).toMatchObject({ uvWidth: 64, uvHeight: 32 });
    },
  );

  it('uses the project resolution when the format is missing', () => {
    const { scene } = loadBbmodel(json(model({ meta: { format_version: '4.5' }, textures })));
    expect(scene.textures[0]).toMatchObject({ uvWidth: 16, uvHeight: 16 });
  });
});

describe('box-UV size (Blockbench size(), box_uv_float_size)', () => {
  const boxModel = (format: string, from: number[], to: number[]) =>
    json(
      model({
        meta: meta(format, { box_uv: true }),
        resolution: { width: 64, height: 64 },
        elements: [cube({ from, to, faces: { north: {} } })],
      }),
    );

  it('floors with a 1e-7 epsilon', () => {
    // 2.99999999 + 1e-7 floors to 3; 2.999999 does not reach 3.
    expect(northRect(boxModel('free', [0.00000001, 0, 0], [3, 2, 1]), 64, 64)).toEqual([1, 1, 4, 3]);
    expect(northRect(boxModel('free', [0.000001, 0, 0], [3, 2, 1]), 64, 64)).toEqual([1, 1, 3, 3]);
  });

  it('keeps fractional sizes in modded_entity', () => {
    expect(northRect(boxModel('modded_entity', [0, 0, 0], [4.5, 2, 1]), 64, 64)).toEqual([1, 1, 5.5, 3]);
  });

  it('ignores stretch and inflate', () => {
    const element = cube({ from: [0, 0, 0], to: [4, 2, 1], stretch: [2, 2, 2], inflate: 1, faces: { north: {} } });
    const text = json(
      model({ meta: meta('free', { box_uv: true }), resolution: { width: 64, height: 64 }, elements: [element] }),
    );
    expect(northRect(text, 64, 64)).toEqual([1, 1, 5, 3]);
  });
});

describe('face texture by uuid', () => {
  it('resolves against textures[].uuid', () => {
    const textures = [
      { name: 'a', uuid: 't-a' },
      { name: 'b', uuid: 't-b' },
    ];
    const element = cube({ faces: { up: { uv: [0, 0, 1, 1], texture: 't-b' } } });
    const { scene } = loadBbmodel(json(model({ textures, elements: [element] })));
    expect(scene.meshes[0]?.groups).toEqual([{ material: 1, start: 0, count: 6 }]);
  });
});

describe('byte-order mark', () => {
  it('is accepted on text and on bytes', () => {
    const text = json(model());
    expect(loadBbmodel('﻿' + text).scene.meshes).toHaveLength(1);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    expect(loadBbmodel(bytes).scene.meshes).toHaveLength(1);
  });
});

describe('limit overrides', () => {
  it.each<[string, number]>([
    ['NaN', NaN],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['-Infinity', -Infinity],
  ])('rejects %s with a RangeError', (_name, value) => {
    expect(() => loadBbmodel(json(model()), { limits: { maxElements: value } })).toThrow(RangeError);
  });

  it('rejects a non-number from untyped callers', () => {
    const limits = { maxTriangles: '12' } as unknown as Partial<BbmodelLimits>;
    expect(() => loadBbmodel(json(model()), { limits })).toThrow(RangeError);
  });

  it('accepts positive integers and Infinity', () => {
    expect(() => loadBbmodel(json(model()), { limits: { maxElements: 1, maxFileBytes: Infinity } })).not.toThrow();
  });
});
