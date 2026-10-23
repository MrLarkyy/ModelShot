import type { RenderedImage, RenderRequest, SetSceneOptions } from '@modelshot/pathtracer';
import { SCENE_FORMAT_VERSION, type SceneCamera, type SceneDocument } from '@modelshot/scene';
import type { FrameRenderer } from '../src/FrameRenderer';

/** A unit cube on node 0 (at the origin) with one animation that moves the node 4 units along +x over 2 s. */
export function cubeScene(): SceneDocument {
  const positions: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) positions.push(x, y, z);
  return {
    formatVersion: SCENE_FORMAT_VERSION,
    source: { format: 'bbmodel', formatVersion: '4.10', modelFormat: 'free' },
    nodes: [
      {
        name: 'cube',
        sourceId: 'cube',
        parent: -1,
        children: [],
        pivot: [0, 0, 0],
        rotation: [0, 0, 0],
        translation: [0, 0, 0],
        visible: true,
        meshes: [0],
      },
    ],
    meshes: [
      {
        name: 'cube',
        sourceId: 'cube',
        node: 0,
        visible: true,
        positions: new Float32Array(positions),
        normals: new Float32Array(positions.length),
        uvs: new Float32Array((positions.length / 3) * 2),
        uvRects: new Float32Array(0),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
        groups: [{ material: 0, start: 0, count: 6 }],
      },
    ],
    materials: [{ name: 'm', texture: -1 }],
    textures: [],
    rootNodes: [0],
    animations: [
      {
        name: 'slide',
        loop: 'loop',
        length: 2,
        channels: [
          {
            node: 0,
            property: 'translation',
            keyframes: [
              { time: 0, value: [0, 0, 0], interpolation: 'linear' },
              { time: 2, value: [4, 0, 0], interpolation: 'linear' },
            ],
          },
        ],
      },
    ],
  };
}

export const CAMERA: SceneCamera = {
  position: [0, 2, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: { kind: 'perspective', fovYDeg: 35 },
  near: 0.1,
  far: 100,
};

export interface FakeRendererOptions {
  /** Loses the context once this many samples of a frame are done. */
  readonly loseAtSample?: number;
  /** `readImage` returns null although nothing was lost. */
  readonly nullImage?: boolean;
  /** Most pixels `resize` grants. */
  readonly maxPixels?: number;
  /** Largest supersampling scale traced (the path tracer lowers a larger one). Default 4. */
  readonly maxSupersample?: number;
}

/**
 * A renderer whose image is a pure function of the request and the camera: each pixel's colour from its position, the
 * seed and the camera's x and z, alpha 0 on the left quarter when transparent. Records every call.
 */
export class FakeRenderer implements FrameRenderer {
  width = 1;
  height = 1;
  samplesDone = 0;
  contextLost = false;
  /** The traced width: `width` times the scale the request runs at (at most `maxSupersample`). */
  accumulationWidth = 1;
  readonly calls: string[] = [];
  readonly cameras: SceneCamera[] = [];
  readonly requests: RenderRequest[] = [];
  readonly scenes: SceneDocument[] = [];
  readonly sceneOptions: (SetSceneOptions | undefined)[] = [];
  private request: RenderRequest | null = null;
  private camera: SceneCamera | null = null;
  private cancelled = false;

  constructor(private readonly options: FakeRendererOptions = {}) {}

  setScene(doc: SceneDocument, options?: SetSceneOptions): Promise<{ applied: boolean }> {
    this.calls.push('setScene');
    this.scenes.push(doc);
    this.sceneOptions.push(options);
    return Promise.resolve({ applied: true });
  }

  setCamera(camera: SceneCamera): void {
    this.calls.push('setCamera');
    this.cameras.push(camera);
    this.camera = camera;
  }

  resize(size: { cssWidth: number; cssHeight: number; devicePixelRatio: number }): { width: number; height: number } {
    this.calls.push('resize');
    const scale = Math.min(1, Math.sqrt((this.options.maxPixels ?? Infinity) / (size.cssWidth * size.cssHeight)));
    this.width = Math.floor(size.cssWidth * scale);
    this.height = Math.floor(size.cssHeight * scale);
    return { width: this.width, height: this.height };
  }

  start(request: RenderRequest): void {
    this.calls.push('start');
    this.requests.push(request);
    this.request = request;
    this.samplesDone = 0;
    this.accumulationWidth = this.width * Math.min(request.supersample ?? 1, this.options.maxSupersample ?? 4);
    this.cancelled = false;
  }

  step(maxSamples = 1): number {
    const request = this.request;
    if (!request || this.cancelled || this.contextLost) return 0;
    const count = Math.min(maxSamples, request.samples - this.samplesDone);
    this.samplesDone += count;
    if (this.options.loseAtSample !== undefined && this.samplesDone >= this.options.loseAtSample) {
      this.contextLost = true;
    }
    return count;
  }

  cancel(): void {
    this.calls.push('cancel');
    this.cancelled = true;
  }

  readImage(): RenderedImage | null {
    const request = this.request;
    if (!request || this.contextLost || this.options.nullImage || this.samplesDone === 0) return null;
    const { width, height } = this;
    const data = new Uint8ClampedArray(width * height * 4);
    const position = this.camera?.position ?? [0, 0, 0];
    const shift = Math.round(position[0] * 10) + Math.round(position[2] * 10) * 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = (x * 37 + request.seed + shift) & 0xff;
        data[i + 1] = (y * 23) & 0xff;
        data[i + 2] = ((x ^ y) * 11) & 0xff;
        data[i + 3] = request.transparent && x < width / 4 ? 0 : 255;
      }
    }
    return { width, height, data };
  }
}

/** All bytes of a Blob. */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
