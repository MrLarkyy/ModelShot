import { describe, expect, it } from 'vitest';
import { checkExportOptions } from '../src/checkExportOptions';
import { ExportError } from '../src/ExportError';
import { MAX_CLIP_FRAMES, MAX_CLIP_RAW_BYTES, MAX_EXPORT_SIDE } from '../src/exportLimits';
import { CAMERA, cubeScene } from './support';

const doc = cubeScene();
const STILL = { kind: 'still', width: 64, height: 48, camera: CAMERA, samples: 16, seed: 1 } as const;
const TURNTABLE = { ...STILL, kind: 'turntable', format: 'apng', fps: 12, frames: 8 } as const;
const ANIMATION = { ...STILL, kind: 'animation', format: 'gif', fps: 10, animation: 0 } as const;

/** The ExportError `options` fail with: its code and field. */
function failure(options: unknown): { code: string; field: string | undefined } {
  try {
    checkExportOptions(doc, options);
  } catch (error) {
    if (!(error instanceof ExportError)) throw error;
    return { code: error.code, field: error.field };
  }
  throw new Error(`accepted ${JSON.stringify(options)}`);
}

const BAD_NUMBERS: readonly unknown[] = [NaN, Infinity, -Infinity, -1, 0.5, '16', null, true, {}, [16]];

describe('checkExportOptions', () => {
  it('fills the defaults of a still and a clip', () => {
    expect(checkExportOptions(doc, STILL)).toMatchObject({
      kind: 'still',
      format: 'png',
      frames: 1,
      supersample: 1,
      denoise: false,
      transparent: false,
      scene: {},
    });
    expect(checkExportOptions(doc, TURNTABLE)).toMatchObject({ frames: 8, framing: 'fit', fps: 12 });
    // The animation's 2 s at 10 fps.
    expect(checkExportOptions(doc, ANIMATION)).toMatchObject({ frames: 20, seconds: 2, animation: 0 });
    expect(checkExportOptions(doc, { ...ANIMATION, animation: 'slide', seconds: 0.25 })).toMatchObject({
      frames: 3,
      animation: 0,
      loop: 'loop',
    });
    // Counted as animationFrameTimes counts export frames: hold and once end on the frame at the last second.
    expect(checkExportOptions(doc, { ...ANIMATION, loop: 'hold' })).toMatchObject({ frames: 21, loop: 'hold' });
    expect(checkExportOptions(doc, { ...ANIMATION, loop: 'once', seconds: 0.25 })).toMatchObject({ frames: 3 });
  });

  it('rejects options that are not an object or have no known kind', () => {
    for (const options of [null, undefined, 3, 'still', [STILL]]) expect(failure(options).field).toBe('options');
    expect(failure({ ...STILL, kind: 'movie' })).toEqual({ code: 'INVALID_OPTION', field: 'kind' });
  });

  it.each(['width', 'height', 'samples', 'seed', 'supersample', 'fps', 'frames'])(
    'rejects a %s that is not a whole number in range, naming it',
    (field) => {
      for (const value of BAD_NUMBERS) {
        expect(failure({ ...TURNTABLE, [field]: value }), `${field}: ${String(value)}`).toEqual({
          code: 'INVALID_OPTION',
          field,
        });
      }
    },
  );

  it('rejects values past each range', () => {
    expect(failure({ ...STILL, samples: 65537 }).field).toBe('samples');
    expect(failure({ ...STILL, seed: 2 ** 32 }).field).toBe('seed');
    expect(failure({ ...STILL, supersample: 5 }).field).toBe('supersample');
    expect(failure({ ...TURNTABLE, fps: 61 }).field).toBe('fps');
    expect(failure({ ...TURNTABLE, frames: 1 }).field).toBe('frames');
    for (const field of ['denoise', 'transparent']) {
      expect(failure({ ...STILL, [field]: 'yes' })).toEqual({ code: 'INVALID_OPTION', field });
    }
    expect(failure({ ...TURNTABLE, format: 'avi' }).field).toBe('format');
    expect(failure({ ...STILL, format: 'gif' }).field).toBe('format');
    expect(failure({ ...TURNTABLE, framing: 'zoom' }).field).toBe('framing');
    expect(failure({ ...ANIMATION, loop: 'bounce' }).field).toBe('loop');
  });

  it('reports a size, frame count, duration or byte total over its limit as LIMIT_EXCEEDED', () => {
    expect(failure({ ...STILL, width: MAX_EXPORT_SIDE + 1 })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'width' });
    expect(failure({ ...STILL, height: 2 ** 31 })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'height' });
    expect(failure({ ...TURNTABLE, frames: MAX_CLIP_FRAMES + 1 })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'frames' });
    // 1200 frames at 12 fps: 100 s.
    expect(failure({ ...TURNTABLE, frames: MAX_CLIP_FRAMES })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'frames' });
    expect(failure({ ...ANIMATION, seconds: 61 })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'seconds' });
    expect(failure({ ...ANIMATION, fps: 60, seconds: 30 })).toEqual({ code: 'LIMIT_EXCEEDED', field: 'seconds' });
    // 4096 x 4096 x 4 bytes is 64 MiB a frame: 33 frames pass 2 GiB.
    const big = { ...TURNTABLE, width: 4096, height: 4096, frames: 33, fps: 60 };
    expect(big.width * big.height * 4 * big.frames).toBeGreaterThan(MAX_CLIP_RAW_BYTES);
    expect(failure(big)).toEqual({ code: 'LIMIT_EXCEEDED', field: 'frames' });
    expect(() => checkExportOptions(doc, { ...big, frames: 32 })).not.toThrow();
  });

  it('needs an even size for video formats only', () => {
    expect(failure({ ...TURNTABLE, format: 'mp4', width: 63 })).toEqual({ code: 'INVALID_OPTION', field: 'width' });
    expect(failure({ ...TURNTABLE, format: 'webm', height: 47 })).toEqual({ code: 'INVALID_OPTION', field: 'height' });
    expect(() => checkExportOptions(doc, { ...TURNTABLE, format: 'gif', width: 63 })).not.toThrow();
  });

  it('checks the camera like the path tracer, naming the part at fault', () => {
    const cases: [unknown, string][] = [
      [null, 'camera'],
      [{ ...CAMERA, position: [0, NaN, 1] }, 'camera.position[1]'],
      [{ ...CAMERA, target: [0, 0] }, 'camera.target'],
      [{ ...CAMERA, up: 'up' }, 'camera.up'],
      [{ ...CAMERA, near: Infinity }, 'camera.near'],
      [{ ...CAMERA, projection: { kind: 'fisheye' } }, 'camera.projection.kind'],
      [{ ...CAMERA, projection: { kind: 'perspective', fovYDeg: '35' } }, 'camera.projection.fovYDeg'],
      [{ ...CAMERA, projection: { kind: 'perspective', fovYDeg: 180 } }, 'camera'],
      [{ ...CAMERA, near: 5, far: 1 }, 'camera'],
      [{ ...CAMERA, target: CAMERA.position }, 'camera'],
    ];
    for (const [camera, field] of cases) {
      expect(failure({ ...STILL, camera }), JSON.stringify(camera)).toEqual({ code: 'INVALID_OPTION', field });
    }
  });

  it('checks the scene options and the animation against the document', () => {
    expect(failure({ ...STILL, scene: 'catcher' }).field).toBe('scene');
    expect(failure({ ...STILL, scene: { shadowCatcher: 1 } }).field).toBe('scene.shadowCatcher');
    expect(
      failure({
        ...STILL,
        scene: {
          emission: [
            [1, 2, 3],
            [0, 0, 0],
          ],
        },
      }).field,
    ).toBe('scene.emission');
    expect(failure({ ...STILL, scene: { emission: [[1, 'x', 3]] } }).field).toBe('scene.emission[0][1]');
    expect(checkExportOptions(doc, { ...STILL, scene: { shadowCatcher: false, emission: [[1, 2, 3]] } }).scene).toEqual(
      { shadowCatcher: false, emission: [[1, 2, 3]] },
    );
    for (const animation of [1, -1, 0.5, 'walk', null]) {
      expect(failure({ ...ANIMATION, animation }), String(animation)).toEqual({
        code: 'INVALID_OPTION',
        field: 'animation',
      });
    }
    for (const length of [NaN, -1, Infinity]) {
      const broken = { ...doc, animations: [{ ...doc.animations![0]!, length }] };
      expect(() => checkExportOptions(broken, ANIMATION), String(length)).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTION', field: 'animation' }),
      );
    }
    for (const seconds of [0, -1, NaN, '2']) {
      expect(failure({ ...ANIMATION, seconds }), String(seconds)).toEqual({ code: 'INVALID_OPTION', field: 'seconds' });
    }
  });

  it('copies the camera, so changing the caller’s object later changes nothing', () => {
    const camera = { ...CAMERA, position: [0, 2, 10] as [number, number, number] };
    const checked = checkExportOptions(doc, { ...STILL, camera });
    camera.position[0] = 99;
    expect(checked.camera.position).toEqual([0, 2, 10]);
  });
});
