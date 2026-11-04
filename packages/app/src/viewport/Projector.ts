import { cameraProjection, cameraView, mat4Multiply, type Mat4, type SceneCamera, type Vec3 } from '@modelshot/scene';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** World points to CSS pixels of a viewport `width` × `height` as the camera draws it; a point behind the near plane is null. */
export class Projector {
  private readonly matrix: Mat4;
  private readonly view: Mat4;

  constructor(
    camera: SceneCamera,
    readonly width: number,
    readonly height: number,
  ) {
    this.view = cameraView(camera);
    this.matrix = mat4Multiply(cameraProjection(camera, width / Math.max(1, height)), this.view);
  }

  project(p: Vec3): ScreenPoint | null {
    const m = this.matrix;
    const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
    const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
    const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
    const z = this.view[2]! * p[0] + this.view[6]! * p[1] + this.view[10]! * p[2] + this.view[14]!;
    // The view looks down −z: a point in front has a negative view z.
    if (z >= 0 || !(w > 0)) return null;
    return { x: ((x / w) * 0.5 + 0.5) * this.width, y: (0.5 - (y / w) * 0.5) * this.height };
  }

  /** 1 when `direction` points towards the viewer, else -1. */
  depthSign(direction: Vec3): 1 | -1 {
    const v = this.view;
    return v[2]! * direction[0] + v[6]! * direction[1] + v[10]! * direction[2] >= 0 ? 1 : -1;
  }
}
