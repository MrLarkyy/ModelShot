import shapesMtl from '../fixtures/obj/shapes.mtl?raw';
import { describe, expect, it } from 'vitest';
import { listMtlReferences } from '../../src/index';
import { expectCpuBelow } from '../support/expectCpuBelow';
import { lines } from './fixtures';

const MAX = { maxReferences: 31 };

describe('listMtlReferences', () => {
  it('lists the texture of shapes.mtl', () => {
    expect(listMtlReferences(shapesMtl, MAX)).toEqual(['shapes.png']);
  });

  it('skips map options as the loader does and keeps names with spaces whole', () => {
    const mtl = lines(
      'newmtl a',
      'map_Kd -s 1 1 1 ../textures/checker tile.png',
      'newmtl b',
      'map_Kd -o 0.5 -clamp on b.png',
      'newmtl c',
      'map_Kd -s 2 c.png',
    );
    expect(listMtlReferences(mtl, MAX)).toEqual(['../textures/checker tile.png', 'b.png', 'c.png']);
  });

  it('takes the last map_Kd of a material and the first definition of a name, each spelling once', () => {
    const mtl = lines(
      'map_Kd outside.png',
      'newmtl a',
      'map_Kd first.png',
      'map_Kd last.png',
      'newmtl a',
      'map_Kd again.png',
      'newmtl b',
      'map_Kd ./last.png',
      'newmtl c',
    );
    expect(listMtlReferences(mtl, MAX)).toEqual(['last.png', './last.png']);
  });

  it('lists nothing for a file the loader refuses', () => {
    expect(listMtlReferences(lines('newmtl a', 'map_Kd a.png', 'x'.repeat(5000)), MAX)).toEqual([]);
  });

  it('stops after one more than the maximum, in bounded time', () => {
    const mtl = Array.from({ length: 50_000 }, (_, i) => `newmtl m${i}\nmap_Kd t${i}.png`).join('\n');
    const listed = expectCpuBelow(200, () => listMtlReferences(mtl, MAX));
    expect(listed).toHaveLength(32);
  });
});
