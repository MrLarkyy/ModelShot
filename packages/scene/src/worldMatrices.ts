import { mat4Multiply, mat4NodeLocal, type Mat4 } from './Mat4';
import type { SceneNode } from './SceneNode';

/** World matrix of every node (`parent world · local`), indexed like `nodes`. Requires parents before children. */
export function worldMatrices(nodes: readonly SceneNode[]): Mat4[] {
  const world: Mat4[] = [];
  nodes.forEach((node, index) => {
    const local = mat4NodeLocal(node.translation, node.pivot, node.rotation);
    if (node.parent < 0) {
      world.push(local);
      return;
    }
    const parentWorld = node.parent < index ? world[node.parent] : undefined;
    if (!parentWorld) throw new RangeError(`node ${index} has parent ${node.parent}; parents must come first`);
    world.push(mat4Multiply(parentWorld, local));
  });
  return world;
}
