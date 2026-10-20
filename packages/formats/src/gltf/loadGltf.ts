import { mat4Multiply, SCENE_FORMAT_VERSION, type Mat4, type SceneMesh } from '@modelshot/scene';
import type { WalkedNode } from './walkNodes';
import { ResourceFiles } from '../resources/ResourceFiles';
import { resolveUnitScale } from '../limits/resolveLimits';
import { mat3FromMat4, mat3IsDegenerate } from '../math/Mat3';
import { bakeMesh } from './bakeMesh';
import { decodePrimitive, type DecodedPrimitive } from './decodePrimitive';
import { planPrimitive, type PrimitiveContext, type PrimitivePlan } from './planPrimitive';
import { convertMaterials } from './convertMaterials';
import { GltfAccessors } from './GltfAccessors';
import { GltfBuffers } from './GltfBuffers';
import { GltfError } from './GltfError';
import { DEFAULT_GLTF_UNIT_SCALE, resolveGltfLimits, type GltfLimits, type GltfLoadOptions } from './GltfLoadOptions';
import type { GltfLoadResult } from './GltfLoadResult';
import { GltfWarningList } from './GltfWarning';
import { childPath, type JsonObject } from '../json/JsonObject';
import { readList, readObject, readObjects, readOptionalString } from './gltfFields';
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

  const instances = sizeInstances(walk.walked, plans, unitScale, limits, warnings);
  const decoded = new Map<PrimitivePlan, DecodedPrimitive>();
  const bake = {
    materials: uvs,
    warnings,
    reportedWrap: new Set<number>(),
    decoded: (plan: PrimitivePlan): DecodedPrimitive => {
      let data = decoded.get(plan);
      if (!data) {
        data = decodePrimitive(plan, accessors, uvs);
        decoded.set(plan, data);
      }
      return data;
    },
  };
  const sceneMeshes: SceneMesh[] = instances.map(({ node, mesh, transform }) => {
    const path = childPath('$.meshes', mesh);
    const name = readOptionalString(meshes[mesh] ?? {}, 'name', path, limits.maxStringChars, `mesh ${mesh}`);
    return bakeMesh(name, node, transform, plans[mesh] ?? [], bake);
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

interface Instance {
  readonly node: number;
  readonly mesh: number;
  /** glTF world matrix with the unit scale applied. */
  readonly transform: Mat4;
}

/**
 * Sizes every mesh instance before anything is decoded or allocated: triangles, baked vertices and drawn primitives
 * summed over every instance, and the source vertices decoded (once per primitive, however many nodes draw it)
 * against `maxVertices`, since an index list can address far more vertices than it draws.
 */
function sizeInstances(
  walked: readonly WalkedNode[],
  plans: readonly PrimitivePlan[][],
  unitScale: number,
  limits: GltfLimits,
  warnings: GltfWarningList,
): Instance[] {
  const scale = Float64Array.from([unitScale, 0, 0, 0, 0, unitScale, 0, 0, 0, 0, unitScale, 0, 0, 0, 0, 1]);
  const instances: Instance[] = [];
  const decodedPlans = new Set<PrimitivePlan>();
  let triangles = 0;
  let vertices = 0;
  let decodedVertices = 0;
  let drawn = 0;
  for (const node of walked) {
    if (node.mesh === undefined) continue;
    const transform = mat4Multiply(scale, node.world);
    if (mat3IsDegenerate(mat3FromMat4(transform))) {
      warnings.add('DEGENERATE_TRANSFORM', node.path, 'its transform flattens the mesh to zero volume');
      continue;
    }
    const meshPlans = plans[node.mesh] ?? [];
    // A mesh whose every primitive was skipped (and reported) draws nothing.
    if (meshPlans.length === 0) continue;
    for (const plan of meshPlans) {
      triangles += plan.triangles;
      vertices += plan.vertices;
      if (!decodedPlans.has(plan)) {
        decodedPlans.add(plan);
        decodedVertices += plan.positions.count;
      }
    }
    drawn += meshPlans.length;
    if (triangles > limits.maxTriangles) {
      throw new GltfError('TOO_MANY_TRIANGLES', node.path, `more than ${limits.maxTriangles} triangles`);
    }
    if (vertices > limits.maxVertices) {
      throw new GltfError('TOO_MANY_VERTICES', node.path, `more than ${limits.maxVertices} vertices`);
    }
    if (decodedVertices > limits.maxVertices) {
      throw new GltfError(
        'TOO_MANY_VERTICES',
        node.path,
        `its primitives address more than ${limits.maxVertices} vertices`,
      );
    }
    if (drawn > limits.maxDrawnPrimitives) {
      throw new GltfError('TOO_MANY_PRIMITIVES', node.path, `more than ${limits.maxDrawnPrimitives} primitives drawn`);
    }
    instances.push({ node: node.sceneIndex, mesh: node.mesh, transform });
  }
  return instances;
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
