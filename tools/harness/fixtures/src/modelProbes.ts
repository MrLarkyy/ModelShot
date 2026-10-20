import type { SceneDocument } from '@modelshot/scene';
import type { ModelViewProbe } from './fixtureApi';
import { MODEL_VIEW_LOOK, projectToPixel, type Matrix, type Point3 } from './modelViewCamera';
import type { SceneTriangles } from './sceneTriangles';
import type { UploadedTextures } from './sceneUpload';

/** A point on a mesh, given by its texture UV (in the texture's uv units); `groundY` asks for its shadow instead. */
export interface ProbeRequest {
  readonly name: string;
  readonly mesh: string;
  readonly uv: readonly [number, number];
  /** Height of the horizontal receiver: the probe is where the light ray through the point meets it. */
  readonly groundY?: number;
}

/**
 * Pixels of chosen texels (or of their shadows on a horizontal receiver) under the fixture camera, with the texel's
 * colour, so a test can check what the image shows there without trusting the renderer that drew it.
 */
export function computeProbes(
  scene: SceneDocument,
  triangles: SceneTriangles,
  textures: UploadedTextures,
  requests: readonly ProbeRequest[],
  viewProjection: Matrix,
  size: number,
): ModelViewProbe[] {
  return requests.map((request) => {
    const found = locate(scene, triangles, request);
    if (!found)
      throw new Error(`probe ${request.name}: no triangle of "${request.mesh}" covers uv ${request.uv.join(', ')}`);
    let point = found.point;
    if (request.groundY !== undefined) {
      const { toLight } = MODEL_VIEW_LOOK;
      const s = (point[1] - request.groundY) / toLight[1];
      point = [point[0] - toLight[0] * s, request.groundY, point[2] - toLight[2] * s];
    }
    const pixel = projectToPixel(viewProjection, point, size, size);
    if (!pixel) throw new Error(`probe ${request.name} is behind the camera`);
    return { name: request.name, x: pixel[0], y: pixel[1], texel: texelColour(textures, found.layer, found.uv) };
  });
}

function locate(scene: SceneDocument, triangles: SceneTriangles, request: ProbeRequest) {
  for (let t = 0; t < triangles.count; t++) {
    if (scene.meshes[triangles.meshes[t] ?? -1]?.name !== request.mesh) continue;
    const material = scene.materials[(triangles.materials[t] ?? 0) - 1];
    const texture = material ? scene.textures[material.texture] : undefined;
    if (!material || !texture) continue;
    const target: [number, number] = [request.uv[0] / texture.uvWidth, request.uv[1] / texture.uvHeight];
    const uv = (c: number): [number, number] => [
      triangles.uvs[t * 6 + c * 2] ?? 0,
      triangles.uvs[t * 6 + c * 2 + 1] ?? 0,
    ];
    const bary = barycentric(target, uv(0), uv(1), uv(2));
    if (!bary || bary.some((b) => b < -1e-6)) continue;
    const point = [0, 1, 2].map((k) =>
      bary.reduce((sum, b, c) => sum + b * (triangles.positions[t * 9 + c * 3 + k] ?? 0), 0),
    ) as unknown as Point3;
    return { point, layer: material.texture, uv: target };
  }
  return undefined;
}

function barycentric(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): [number, number, number] | undefined {
  const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(det) < 1e-12) return undefined;
  const l0 = ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
  const l1 = ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det;
  return [l0, l1, 1 - l0 - l1];
}

function texelColour(textures: UploadedTextures, layer: number, uv: readonly [number, number]): number[] {
  const [width, height] = textures.sizes[layer] ?? [1, 1];
  const x = Math.min(width - 1, Math.floor(uv[0] * width));
  const y = Math.min(height - 1, Math.floor(uv[1] * height));
  const pixels = textures.pixels[layer];
  const i = (y * width + x) * 4;
  return [0, 1, 2, 3].map((k) => pixels?.[i + k] ?? 0);
}
