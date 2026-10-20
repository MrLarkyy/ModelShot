import { mat4Multiply, SCENE_FORMAT_VERSION, type Mat4, type SceneMesh } from '@modelshot/scene';
import { ResourceFiles } from '../resources/ResourceFiles';
import { resolveUnitScale } from '../limits/resolveLimits';
import { bakeMesh, isDegenerate, planPrimitive, type PrimitiveContext, type PrimitivePlan } from './bakePrimitive';
import { convertMaterials } from './convertMaterials';
import { GltfAccessors } from './GltfAccessors';
import { GltfBuffers } from './GltfBuffers';
import { GltfError } from './GltfError';
import { DEFAULT_GLTF_UNIT_SCALE, resolveGltfLimits, type GltfLimits, type GltfLoadOptions } from './GltfLoadOptions';
import type { GltfLoadResult } from './GltfLoadResult';
import { GltfWarningList } from './GltfWarning';
import { childPath, readList, readObject, readObjects, readOptionalString, type JsonObject } from './gltfFields';
import { readContainer } from './readContainer';
import { reportUnsupported } from './reportUnsupported';
import { walkNodes } from './walkNodes';

/**
 * Loads a glTF 2.0 model (`.gltf` text or bytes with `data:` URIs or picked files, or a `.glb`) as static meshes:
 * the active scene's node hierarchy with every world transform baked into the vertices, base colour textures (PNG),
 * alpha modes and sidedness. Synchronous and bounded: counts, sizes and depth are checked against `limits` before
 * anything proportional to them is allocated or decoded; nothing is fetched. A bad file throws only `GltfError`;
 * whatever the scene format cannot carry is a warning. Invalid `options` throw a `RangeError`.
 */
export function loadGltf(input: string | Uint8Array, options: GltfLoadOptions = {}): GltfLoadResult {
  const limits = resolveGltfLimits(options.limits);
  const unitScale = resolveUnitScale(options.unitScale, DEFAULT_GLTF_UNIT_SCALE);
  const warnings = new GltfWarningList();
  const container = readContainer(input, limits.maxFileBytes);
  const { json } = container;
  reportUnsupported(json, limits, warnings);
  const files = new ResourceFiles(options.files);
  const buffers = new GltfBuffers(json, { bin: container.bin, files, limits });
  const accessors = new GltfAccessors(json, buffers, limits);
  const meshes = readObjects(
    readList(json, 'meshes', '$', { max: limits.maxMeshes, code: 'TOO_MANY_MESHES', what: 'meshes' }),
    '$.meshes',
  );
  const walk = walkNodes(json, meshes.length, limits, warnings);
  const { materials, textures, uvs } = convertMaterials(json, { accessors, files, limits, warnings });
  const context: PrimitiveContext = { accessors, materials: uvs, warnings };
  const plans = planMeshes(meshes, context, limits);

  // Every instance is sized before any geometry is decoded or allocated.
  const scale = Float64Array.from([unitScale, 0, 0, 0, 0, unitScale, 0, 0, 0, 0, unitScale, 0, 0, 0, 0, 1]);
  const instances: { node: number; mesh: number; transform: Mat4 }[] = [];
  let triangles = 0;
  let vertices = 0;
  for (const walked of walk.walked) {
    if (walked.mesh === undefined) continue;
    const transform = mat4Multiply(scale, walked.world);
    if (isDegenerate(transform)) {
      warnings.add('DEGENERATE_TRANSFORM', walked.path, 'its transform flattens the mesh to zero volume');
      continue;
    }
    for (const plan of plans[walked.mesh] ?? []) {
      triangles += plan.triangles;
      vertices += plan.vertices;
    }
    if (triangles > limits.maxTriangles) {
      throw new GltfError('TOO_MANY_TRIANGLES', walked.path, `more than ${limits.maxTriangles} triangles`);
    }
    if (vertices > limits.maxVertices) {
      throw new GltfError('TOO_MANY_VERTICES', walked.path, `more than ${limits.maxVertices} vertices`);
    }
    instances.push({ node: walked.sceneIndex, mesh: walked.mesh, transform });
  }

  const reportedWrap = new Set<number>();
  const sceneMeshes: SceneMesh[] = instances.map(({ node, mesh, transform }) => {
    const path = childPath('$.meshes', mesh);
    const name = readOptionalString(meshes[mesh] ?? {}, 'name', path, limits.maxStringChars, `mesh ${mesh}`);
    return bakeMesh(name, node, transform, plans[mesh] ?? [], context, reportedWrap);
  });
  sceneMeshes.forEach((mesh, index) => walk.nodes[mesh.node]?.meshes.push(index));

  return {
    scene: {
      formatVersion: SCENE_FORMAT_VERSION,
      source: { format: 'gltf', formatVersion: container.version, modelFormat: container.kind },
      nodes: walk.nodes,
      meshes: sceneMeshes,
      materials,
      textures,
      rootNodes: walk.rootNodes,
    },
    warnings: warnings.items,
  };
}

/** The drawn primitives of every mesh, validated once however many nodes use the mesh. */
function planMeshes(meshes: readonly JsonObject[], context: PrimitiveContext, limits: GltfLimits): PrimitivePlan[][] {
  let primitives = 0;
  return meshes.map((mesh, index) => {
    const path = childPath('$.meshes', index);
    const list = readList(mesh, 'primitives', path, {
      max: limits.maxPrimitives,
      code: 'TOO_MANY_PRIMITIVES',
      what: 'primitives',
    });
    primitives += list.length;
    if (primitives > limits.maxPrimitives) {
      throw new GltfError('TOO_MANY_PRIMITIVES', path, `more than ${limits.maxPrimitives} primitives in the file`);
    }
    return list.flatMap((value, k) => {
      const primitivePath = childPath(childPath(path, 'primitives'), k);
      return planPrimitive(readObject(value, primitivePath), primitivePath, context) ?? [];
    });
  });
}
