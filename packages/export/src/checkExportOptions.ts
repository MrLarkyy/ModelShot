import { MAX_SAMPLES, MAX_SEED, MAX_SUPERSAMPLE, cameraUniforms, type SetSceneOptions } from '@modelshot/pathtracer';
import {
  animationFrameCount,
  type SceneAnimationLoop,
  type SceneCamera,
  type SceneDocument,
  type SceneProjection,
  type Vec3,
} from '@modelshot/scene';
import { ExportError } from './ExportError';
import type { ClipFormat, ClipFraming, ExportFormat } from './ExportOptions';
import {
  MAX_CLIP_FPS,
  MAX_CLIP_FRAMES,
  MAX_CLIP_RAW_BYTES,
  MAX_CLIP_SECONDS,
  MAX_EXPORT_PIXELS,
  MAX_EXPORT_SIDE,
} from './exportLimits';

/** The fields every checked export has, with their defaults; the camera and scene options are fresh copies. */
export interface CheckedRenderSettings {
  readonly width: number;
  readonly height: number;
  readonly camera: SceneCamera;
  readonly samples: number;
  readonly seed: number;
  readonly supersample: number;
  readonly denoise: boolean;
  readonly transparent: boolean;
  readonly scene: SetSceneOptions;
  /** Frames the export renders: 1 for a still. */
  readonly frames: number;
}

export interface CheckedStillOptions extends CheckedRenderSettings {
  readonly kind: 'still';
  readonly format: 'png';
}

export interface CheckedTurntableOptions extends CheckedRenderSettings {
  readonly kind: 'turntable';
  readonly format: ClipFormat;
  readonly fps: number;
  readonly framing: ClipFraming;
}

export interface CheckedAnimationOptions extends CheckedRenderSettings {
  readonly kind: 'animation';
  readonly format: ClipFormat;
  readonly fps: number;
  readonly framing: ClipFraming;
  /** Index into `SceneDocument.animations`. */
  readonly animation: number;
  readonly seconds: number;
  /** The loop mode played: the option, else the animation's. */
  readonly loop: SceneAnimationLoop;
}

export type CheckedClipOptions = CheckedTurntableOptions | CheckedAnimationOptions;

export type CheckedExportOptions = CheckedStillOptions | CheckedClipOptions;

const CLIP_FORMATS: readonly ClipFormat[] = ['apng', 'gif', 'webp', 'webm', 'mp4'];
const VIDEO_FORMATS: readonly ExportFormat[] = ['webm', 'mp4'];
const FRAMINGS: readonly ClipFraming[] = ['fit', 'camera'];
const LOOPS: readonly SceneAnimationLoop[] = ['once', 'hold', 'loop'];
const KEYS = new Set(['still', 'turntable', 'animation']);

type Fields = Readonly<Record<string, unknown>>;

const invalid = (field: string, message: string): ExportError =>
  new ExportError('INVALID_OPTION', `${field} ${message}`, field);

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value);
  }
  return Array.isArray(value) ? 'an array' : `a ${typeof value}`;
}

function record(field: string, value: unknown): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(field, `must be an object, got ${describe(value)}`);
  }
  return value as Fields;
}

/** An integer in min..max; over `limit` (a resource cap rather than a range) it is LIMIT_EXCEEDED. */
function integer(field: string, value: unknown, min: number, max: number, limit = false): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(field, `must be an integer, got ${describe(value)}`);
  }
  if (value > max && limit) {
    throw new ExportError('LIMIT_EXCEEDED', `${field} ${value} is over the limit of ${max}`, field);
  }
  if (value < min || value > max) throw invalid(field, `must be in ${min}..${max}, got ${value}`);
  return value;
}

function finite(field: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(field, `must be a finite number, got ${describe(value)}`);
  }
  return value;
}

function flag(field: string, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw invalid(field, `must be a boolean, got ${describe(value)}`);
  return value;
}

function oneOf<T extends string>(field: string, value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw invalid(field, `must be one of ${values.join(', ')}, got ${describe(value)}`);
  }
  return value as T;
}

function vec3(field: string, value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw invalid(field, `must be 3 numbers, got ${describe(value)}`);
  const items = value as readonly unknown[];
  return [finite(`${field}[0]`, items[0]), finite(`${field}[1]`, items[1]), finite(`${field}[2]`, items[2])];
}

function projection(value: unknown): SceneProjection {
  const fields = record('camera.projection', value);
  const kind = oneOf('camera.projection.kind', fields['kind'], ['perspective', 'orthographic']);
  return kind === 'perspective'
    ? { kind, fovYDeg: finite('camera.projection.fovYDeg', fields['fovYDeg']) }
    : { kind, height: finite('camera.projection.height', fields['height']) };
}

function camera(value: unknown, aspect: number): SceneCamera {
  const fields = record('camera', value);
  const checked: SceneCamera = {
    position: vec3('camera.position', fields['position']),
    target: vec3('camera.target', fields['target']),
    up: vec3('camera.up', fields['up']),
    projection: projection(fields['projection']),
    near: finite('camera.near', fields['near']),
    far: finite('camera.far', fields['far']),
  };
  try {
    // The path tracer's own check, so a camera that passes here never throws in setCamera.
    cameraUniforms(checked, aspect);
  } catch (error) {
    throw invalid('camera', error instanceof Error ? error.message : String(error));
  }
  return checked;
}

function sceneOptions(value: unknown, doc: SceneDocument): SetSceneOptions {
  if (value === undefined) return {};
  const fields = record('scene', value);
  const shadowCatcher = fields['shadowCatcher'];
  if (shadowCatcher !== undefined) flag('scene.shadowCatcher', shadowCatcher);
  const emission = fields['emission'];
  let checkedEmission: (readonly [number, number, number] | undefined)[] | undefined;
  if (emission !== undefined) {
    if (!Array.isArray(emission)) throw invalid('scene.emission', `must be an array, got ${describe(emission)}`);
    const entries = emission as readonly unknown[];
    if (entries.length > doc.materials.length) {
      throw invalid('scene.emission', `has ${entries.length} entries for ${doc.materials.length} materials`);
    }
    checkedEmission = entries.map((entry, i) =>
      entry === undefined ? undefined : vec3(`scene.emission[${i}]`, entry),
    );
  }
  return {
    ...(shadowCatcher !== undefined ? { shadowCatcher: shadowCatcher as boolean } : {}),
    ...(checkedEmission ? { emission: checkedEmission } : {}),
  };
}

function animationIndex(value: unknown, doc: SceneDocument): number {
  const animations = doc.animations ?? [];
  if (typeof value === 'string') {
    const index = animations.findIndex((a) => a.name === value);
    if (index < 0) throw invalid('animation', `names no animation of the document: ${describe(value)}`);
    return index;
  }
  if (animations.length === 0) throw invalid('animation', 'the document has no animations');
  return integer('animation', value, 0, animations.length - 1);
}

/**
 * Checks untrusted export options against the document they apply to, before anything is allocated or rendered: every
 * field for type, integer, finiteness, range and enum, then the limits (`exportLimits`). A bad field throws
 * `ExportError` `INVALID_OPTION`, a limit `LIMIT_EXCEEDED`, both naming the field. Video formats need an even width
 * and height. Returns the options with their defaults and the clip's frame count.
 */
export function checkExportOptions(doc: SceneDocument, options: unknown): CheckedExportOptions {
  const fields = record('options', options);
  const kind = fields['kind'];
  if (typeof kind !== 'string' || !KEYS.has(kind)) {
    throw invalid('kind', `must be one of still, turntable, animation, got ${describe(kind)}`);
  }
  const width = integer('width', fields['width'], 1, MAX_EXPORT_SIDE, true);
  const height = integer('height', fields['height'], 1, MAX_EXPORT_SIDE, true);
  if (width * height > MAX_EXPORT_PIXELS) {
    throw new ExportError(
      'LIMIT_EXCEEDED',
      `width × height ${width * height} pixels is over the limit of ${MAX_EXPORT_PIXELS}`,
      'width',
    );
  }
  const base = {
    width,
    height,
    camera: camera(fields['camera'], width / height),
    samples: integer('samples', fields['samples'], 1, MAX_SAMPLES),
    seed: integer('seed', fields['seed'], 0, MAX_SEED),
    supersample:
      fields['supersample'] === undefined ? 1 : integer('supersample', fields['supersample'], 1, MAX_SUPERSAMPLE),
    denoise: flag('denoise', fields['denoise']),
    transparent: flag('transparent', fields['transparent']),
    scene: sceneOptions(fields['scene'], doc),
  };
  if (kind === 'still') {
    if (fields['format'] !== undefined) oneOf('format', fields['format'], ['png']);
    return { ...base, kind, format: 'png', frames: 1 };
  }
  const format = oneOf('format', fields['format'], CLIP_FORMATS);
  if (VIDEO_FORMATS.includes(format) && (width % 2 !== 0 || height % 2 !== 0)) {
    throw invalid(width % 2 !== 0 ? 'width' : 'height', `must be even for ${format} video, got ${width} × ${height}`);
  }
  const fps = integer('fps', fields['fps'], 1, MAX_CLIP_FPS);
  const framing = fields['framing'] === undefined ? 'fit' : oneOf('framing', fields['framing'], FRAMINGS);
  const clip = { ...base, format, fps, framing };
  let checked: CheckedClipOptions;
  if (kind === 'turntable') {
    checked = { ...clip, kind, frames: integer('frames', fields['frames'], 2, MAX_CLIP_FRAMES, true) };
  } else {
    const animation = animationIndex(fields['animation'], doc);
    const own = doc.animations?.[animation];
    const length = own?.length;
    if (typeof length !== 'number' || !Number.isFinite(length) || length < 0) {
      throw invalid('animation', `has no usable length: ${describe(length)}`);
    }
    const loop = fields['loop'] === undefined ? (own?.loop ?? 'loop') : oneOf('loop', fields['loop'], LOOPS);
    let seconds: number;
    if (fields['seconds'] === undefined) {
      seconds = length;
      if (seconds > MAX_CLIP_SECONDS) {
        throw new ExportError(
          'LIMIT_EXCEEDED',
          `the animation lasts ${seconds} s, over the limit of ${MAX_CLIP_SECONDS} s: set seconds`,
          'seconds',
        );
      }
    } else {
      seconds = finite('seconds', fields['seconds']);
      if (seconds > MAX_CLIP_SECONDS) {
        throw new ExportError(
          'LIMIT_EXCEEDED',
          `seconds ${seconds} is over the limit of ${MAX_CLIP_SECONDS}`,
          'seconds',
        );
      }
      if (!(seconds > 0)) throw invalid('seconds', `must be over 0, got ${seconds}`);
    }
    // Counted as the scene format counts export frames: a loop leaves out the frame equal to frame 0.
    const frames = animationFrameCount({ length: seconds, loop }, fps);
    if (frames > MAX_CLIP_FRAMES) {
      throw new ExportError(
        'LIMIT_EXCEEDED',
        `${frames} frames (${seconds} s at ${fps} fps) is over the limit of ${MAX_CLIP_FRAMES}`,
        'seconds',
      );
    }
    checked = { ...clip, kind: 'animation', animation, seconds, frames, loop };
  }
  if (turntableSeconds(checked) > MAX_CLIP_SECONDS) {
    throw new ExportError(
      'LIMIT_EXCEEDED',
      `${checked.frames} frames at ${fps} fps last over the limit of ${MAX_CLIP_SECONDS} s`,
      'frames',
    );
  }
  const rawBytes = width * height * 4 * checked.frames;
  if (rawBytes > MAX_CLIP_RAW_BYTES) {
    throw new ExportError(
      'LIMIT_EXCEEDED',
      `${checked.frames} frames of ${width} × ${height} are ${rawBytes} bytes of pixels, over the limit of ${MAX_CLIP_RAW_BYTES}`,
      'frames',
    );
  }
  return checked;
}

function turntableSeconds(options: CheckedClipOptions): number {
  return options.kind === 'turntable' ? options.frames / options.fps : 0;
}
