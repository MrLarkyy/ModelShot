import type { RawImage } from '@modelshot/renderer-rt';
import {
  createDataTexture,
  createLayerTexture,
  disposeGpuScene,
  placedImages,
  writeDataRows,
  writeLayerImageRows,
  writeLayerImages,
  type GpuScene,
} from './gpuScene';
import { nextTask } from './nextTask';
import type { DataTexture, PackedGeometry } from './packSceneData';
import type { TextureLayerPlan } from './textureLayers';

/** Rows of a data texture written per task: 4 MiB at `DATA_TEXTURE_WIDTH` RGBA32F texels per row. */
export const BAND_ROWS = 128;
/** Bytes of texture images written per task; an image larger than this is split in row bands of at most this size. */
export const IMAGE_TASK_BYTES = 4 * 1024 * 1024;

/**
 * `uploadGpuScene` spread over tasks: each data texture in bands of at most `BAND_ROWS` rows, the texture images in
 * groups of at most `IMAGE_TASK_BYTES` (a larger image in row bands of that size), one band or group per task, so a large scene never
 * blocks the main thread in one upload. Before each band `current()` and the context are checked: when either fails
 * every texture made here is deleted and the result is `null`. The same bytes as `uploadGpuScene`.
 */
export async function uploadSceneInBands(
  gl: WebGL2RenderingContext,
  geometry: PackedGeometry,
  materials: DataTexture,
  plan: TextureLayerPlan,
  images: readonly (ImageBitmap | RawImage)[],
  current: () => boolean,
): Promise<GpuScene | null> {
  const live = () => current() && !gl.isContextLost();
  if (!live()) return null;
  const scene: GpuScene = {
    nodes: createDataTexture(gl, geometry.nodes.rows),
    triPositions: createDataTexture(gl, geometry.triPositions.rows),
    triAttributes: createDataTexture(gl, geometry.triAttributes.rows),
    materials: createDataTexture(gl, materials.rows),
    layers: createLayerTexture(gl, plan),
    nodeCount: geometry.nodeCount,
    maxRenderOrder: geometry.maxRenderOrder,
  };
  const writes: (() => void)[] = [];
  const data: [WebGLTexture, DataTexture][] = [
    [scene.nodes, geometry.nodes],
    [scene.triPositions, geometry.triPositions],
    [scene.triAttributes, geometry.triAttributes],
    [scene.materials, materials],
  ];
  for (const [handle, texture] of data) {
    for (let from = 0; from < texture.rows; from += BAND_ROWS) {
      writes.push(() => writeDataRows(gl, handle, texture, from, Math.min(BAND_ROWS, texture.rows - from)));
    }
  }
  let group: ReturnType<typeof placedImages> = [];
  let bytes = 0;
  const flush = (placed: ReturnType<typeof placedImages>) => {
    if (placed.length > 0) writes.push(() => writeLayerImages(gl, scene.layers, placed));
  };
  for (const entry of placedImages(plan, images)) {
    const size = entry[0].width * entry[0].height * 4;
    if (size > IMAGE_TASK_BYTES) {
      flush(group);
      group = [];
      bytes = 0;
      const [place, image] = entry;
      const rows = Math.max(1, Math.floor(IMAGE_TASK_BYTES / (place.width * 4)));
      for (let from = 0; from < place.height; from += rows) {
        const count = Math.min(rows, place.height - from);
        writes.push(() => writeLayerImageRows(gl, scene.layers, place, image, from, count));
      }
      continue;
    }
    if (bytes > 0 && bytes + size > IMAGE_TASK_BYTES) {
      flush(group);
      group = [];
      bytes = 0;
    }
    group.push(entry);
    bytes += size;
  }
  flush(group);

  for (const write of writes) {
    write();
    await nextTask();
    if (!live()) {
      disposeGpuScene(gl, scene);
      return null;
    }
  }
  return scene;
}
