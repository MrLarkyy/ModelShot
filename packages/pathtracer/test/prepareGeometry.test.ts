import { MAX_EDGE_WIDTH } from '@modelshot/looks';
import { sceneBounds } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { buildBvh } from '../src/buildBvh';
import { flattenScene, visibleTriangleCount } from '../src/flattenScene';
import { prepareGeometry, preparedTransfer } from '../src/geometry/prepareGeometry';
import { packGeometry } from '../src/packSceneData';
import { PathTracerError } from '../src/PathTracerError';
import { mixedScene } from './testScenes';

const EDGES = { sharpAngleDeg: 30, reach: MAX_EDGE_WIDTH };

describe('prepareGeometry', () => {
  it.each([
    ['with edges', EDGES],
    ['at another angle', { sharpAngleDeg: 60, reach: MAX_EDGE_WIDTH }],
  ])('gives the bytes of flatten, BVH and pack in a row (%s)', (_, edges) => {
    const doc = mixedScene();
    const flat = flattenScene(doc, 1000, edges);
    const bvh = buildBvh(flat.positions, flat.count);
    const packed = packGeometry(flat, bvh, 4096);
    const prepared = prepareGeometry(doc, { maxTriangles: 1000, edges, maxTextureSize: 4096, sceneBounds: true });
    expect(prepared.geometry).toEqual(packed);
    expect(prepared.order).toEqual(bvh.order);
    expect(prepared.sources).toEqual(flat.sources);
    expect([prepared.count, prepared.skipped]).toEqual([flat.count, flat.skipped]);
    expect(prepared.bounds).toEqual(sceneBounds(doc));
  });

  it('leaves the bounds out when the caller brings its own', () => {
    const prepared = prepareGeometry(mixedScene(), {
      maxTriangles: 1000,
      edges: EDGES,
      maxTextureSize: 4096,
      sceneBounds: false,
    });
    expect(prepared.bounds).toBeNull();
  });

  it('throws SCENE_TOO_LARGE over maxTriangles and for rows over maxTextureSize', () => {
    const doc = mixedScene();
    const params = { maxTriangles: 1000, edges: EDGES, maxTextureSize: 4096, sceneBounds: true };
    expect(() => prepareGeometry(doc, { ...params, maxTriangles: 10 })).toThrow(PathTracerError);
    try {
      prepareGeometry(doc, { ...params, maxTextureSize: 1 });
      throw new Error('no error');
    } catch (error) {
      expect((error as PathTracerError).code).toBe('SCENE_TOO_LARGE');
    }
  });

  it('transfers five distinct buffers: nodes, triangle positions and attributes, order and sources', () => {
    const prepared = prepareGeometry(mixedScene(), {
      maxTriangles: 1000,
      edges: EDGES,
      maxTextureSize: 4096,
      sceneBounds: true,
    });
    const transfer = preparedTransfer(prepared);
    expect(transfer).toHaveLength(5);
    expect(transfer).toContain(prepared.sources.buffer);
    expect(transfer).toContain(prepared.geometry.triAttributes.data.buffer);
  });
});

describe('visibleTriangleCount', () => {
  it('counts the visible groups from their counts and throws over the limit with flattenScene’s message', () => {
    const doc = mixedScene();
    expect(visibleTriangleCount(doc)).toBe(12 + 300);
    expect(() => visibleTriangleCount(doc, 311)).toThrow('scene has 312 visible triangles; the limit is 311');
    expect(() => flattenScene(doc, 311)).toThrow('scene has 312 visible triangles; the limit is 311');
  });
});
