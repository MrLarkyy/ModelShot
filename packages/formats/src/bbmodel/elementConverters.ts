import { cubeToMesh } from './cubeToMesh';
import { cubeTriangleCount, readCube } from './CubeSpec';
import type { ElementConverter } from './ElementConverter';
import { meshElementToMesh } from './meshToMesh';
import { meshTriangleCount, meshVertexCount, readMesh } from './MeshSpec';

export const cubeConverter: ElementConverter = {
  prepare(element, path, context) {
    const cube = readCube(element, path, context);
    return {
      triangleCount: cubeTriangleCount(cube),
      vertexCount: cube.faces.length * 4,
      build: (node) => cubeToMesh(cube, node),
    };
  },
};

export const meshConverter: ElementConverter = {
  prepare(element, path, context) {
    const mesh = readMesh(element, path, context);
    return {
      triangleCount: meshTriangleCount(mesh),
      vertexCount: meshVertexCount(mesh),
      build: (node) => meshElementToMesh(mesh, node),
    };
  },
};

/**
 * Converters by element `type` (an element without one is a cube). A `Map`, so a type such as `"__proto__"` or
 * `"constructor"` from a file is simply unknown. Other types are skipped with a warning.
 */
export const ELEMENT_CONVERTERS: ReadonlyMap<string, ElementConverter> = new Map([
  ['cube', cubeConverter],
  ['mesh', meshConverter],
]);
