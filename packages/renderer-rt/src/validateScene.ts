import { MAX_ABS_RENDER_ORDER, type SceneDocument, type SceneMesh } from '@modelshot/scene';
import { RendererError } from './RendererError';

function fail(path: string, message: string): never {
  throw new RendererError('INVALID_SCENE', `invalid scene: ${message}`, path);
}

function checkIndex(value: number, count: number, path: string, allowNone: boolean): void {
  const ok = Number.isInteger(value) && value < count && (value >= 0 || (allowNone && value === -1));
  if (!ok) fail(path, `index ${String(value)} is outside 0..${count - 1}${allowNone ? ' and not -1' : ''}`);
}

function checkArray(
  value: unknown,
  type: typeof Float32Array | typeof Uint32Array,
  length: number,
  path: string,
): void {
  if (!(value instanceof type)) fail(path, `expected a ${type.name}`);
  if (value.length !== length) fail(path, `expected ${length} values, got ${value.length}`);
}

/** A node transform with a non-finite value would give NaN world matrices and silently drop its subtree. */
function checkFiniteVec3(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'expected three numbers');
  for (let k = 0; k < 3; k++) {
    const item: unknown = (value as unknown[])[k];
    if (typeof item !== 'number' || !Number.isFinite(item)) fail(`${path}[${k}]`, 'expected a finite number');
  }
}

function validateMesh(mesh: SceneMesh, path: string, doc: SceneDocument): void {
  checkIndex(mesh.node, doc.nodes.length, `${path}.node`, true);
  const order: unknown = mesh.renderOrder;
  if (order !== undefined && !(Number.isInteger(order) && Math.abs(order as number) <= MAX_ABS_RENDER_ORDER)) {
    fail(
      `${path}.renderOrder`,
      `expected an integer in ±${MAX_ABS_RENDER_ORDER}, got ${typeof order === 'number' ? String(order) : typeof order}`,
    );
  }
  if (!(mesh.positions instanceof Float32Array) || mesh.positions.length % 3 !== 0) {
    fail(`${path}.positions`, 'expected a Float32Array of 3 values per vertex');
  }
  const vertices = mesh.positions.length / 3;
  checkArray(mesh.normals, Float32Array, vertices * 3, `${path}.normals`);
  checkArray(mesh.uvs, Float32Array, vertices * 2, `${path}.uvs`);
  checkArray(mesh.uvRects, Float32Array, vertices * 4, `${path}.uvRects`);
  if (!(mesh.indices instanceof Uint32Array) || mesh.indices.length % 3 !== 0) {
    fail(`${path}.indices`, 'expected a Uint32Array of 3 indices per triangle');
  }
  const indices = mesh.indices;
  for (let i = 0; i < indices.length; i++) {
    if ((indices[i] ?? vertices) >= vertices) fail(`${path}.indices[${i}]`, `vertex ${indices[i]} of ${vertices}`);
  }
  mesh.groups.forEach((group, g) => {
    const groupPath = `${path}.groups[${g}]`;
    checkIndex(group.material, doc.materials.length, `${groupPath}.material`, true);
    const doubleSided: unknown = group.doubleSided;
    if (doubleSided !== undefined && typeof doubleSided !== 'boolean') {
      fail(
        `${groupPath}.doubleSided`,
        `expected true or false, got ${typeof doubleSided === 'string' ? doubleSided : typeof doubleSided}`,
      );
    }
    const { start, count } = group;
    const ok = Number.isInteger(start) && Number.isInteger(count) && start >= 0 && count >= 0;
    if (!ok || start + count > indices.length || start % 3 !== 0 || count % 3 !== 0) {
      fail(groupPath, `range ${start}+${count} is not whole triangles inside ${indices.length} indices`);
    }
  });
}

/**
 * Checks every cross reference, buffer length and node transform (finite `pivot`, `rotation`, `translation` and
 * `restRotation`) the renderer relies on, so a malformed document fails with a
 * `RendererError` `INVALID_SCENE` naming the path instead of reading out of bounds on the GPU; also `renderOrder`
 * (an integer in ±1024, the range the exact depth key maps into depth, `exactDepthRange`) and `doubleSided` (a boolean). Material
 * `alphaMode` / `alphaCutoff` are not checked: `resolveMaterialAlpha` turns any value into a valid rule.
 */
export function validateScene(doc: SceneDocument): void {
  doc.nodes.forEach((node, n) => {
    const path = `nodes[${n}]`;
    if (node.parent !== -1) checkIndex(node.parent, n, `${path}.parent`, false);
    for (const key of ['pivot', 'rotation', 'translation'] as const) checkFiniteVec3(node[key], `${path}.${key}`);
    if (node.restRotation !== undefined) checkFiniteVec3(node.restRotation, `${path}.restRotation`);
    node.meshes.forEach((mesh, i) => checkIndex(mesh, doc.meshes.length, `${path}.meshes[${i}]`, false));
    node.children.forEach((child, i) => checkIndex(child, doc.nodes.length, `${path}.children[${i}]`, false));
  });
  doc.rootNodes.forEach((root, i) => checkIndex(root, doc.nodes.length, `rootNodes[${i}]`, false));
  doc.meshes.forEach((mesh, m) => validateMesh(mesh, `meshes[${m}]`, doc));
  doc.materials.forEach((material, m) =>
    checkIndex(material.texture, doc.textures.length, `materials[${m}].texture`, true),
  );
  doc.textures.forEach((texture, t) => {
    for (const key of ['width', 'height'] as const) {
      const value = texture[key];
      if (!Number.isInteger(value) || value < 0) fail(`textures[${t}].${key}`, `expected a size, got ${value}`);
    }
    if (texture.bytes !== null && !(texture.bytes instanceof Uint8Array)) {
      fail(`textures[${t}].bytes`, 'expected a Uint8Array or null');
    }
  });
}
