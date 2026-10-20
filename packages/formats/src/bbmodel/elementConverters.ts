import { cubeToMesh } from './cubeToMesh';
import { cubeTriangleCount, readCube } from './CubeSpec';
import type { ElementConverter } from './ElementConverter';

export const cubeConverter: ElementConverter = {
  prepare(element, path, context) {
    const cube = readCube(element, path, context);
    return { triangleCount: cubeTriangleCount(cube), build: (node) => cubeToMesh(cube, node) };
  },
};

/**
 * Converters by element `type` (an element without one is a cube). A `Map`, so a type such as `"__proto__"` or
 * `"constructor"` from a file is simply unknown. Other types are skipped with a warning.
 */
export const ELEMENT_CONVERTERS: ReadonlyMap<string, ElementConverter> = new Map([['cube', cubeConverter]]);
