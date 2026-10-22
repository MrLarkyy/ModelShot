import { describe, expect, it } from 'vitest';
import agxSource from '../src/glsl/agx.glsl?raw';
import backdropSource from '../src/glsl/backdrop.glsl?raw';
import lightRigSource from '../src/glsl/lightRig.glsl?raw';
import shadowCatcherSource from '../src/glsl/shadowCatcher.glsl?raw';
import { rimWorldDirection } from '../src/lightRig';
import { DEFAULT_LOOK, LOOK_PRESETS } from '../src/lookPresets';
import { LOOK_VIEW_NONE, lookView } from '../src/LookView';
import {
  LOOK_UNIFORM_NAMES,
  uploadLookUniforms,
  type LookUniformName,
  type LookUniformTarget,
} from '../src/lookUniforms';

function fakeGl(): { gl: LookUniformTarget; calls: [string, string, unknown][] } {
  const calls: [string, string, unknown][] = [];
  const record =
    (method: string) =>
    (location: WebGLUniformLocation | null, value: unknown): void => {
      const name = (location as { name: string }).name;
      calls.push([method, name, value instanceof Float32Array ? [...value] : value]);
    };
  const gl = {
    uniform1f: record('uniform1f'),
    uniform1i: record('uniform1i'),
    uniform3fv: record('uniform3fv'),
    uniform4fv: record('uniform4fv'),
  };
  return { gl, calls };
}

const everywhere = (name: LookUniformName) => ({ name }) as unknown as WebGLUniformLocation;

describe('uploadLookUniforms', () => {
  it('names exactly the uniforms the look chunks declare', () => {
    const declared = [agxSource, backdropSource, lightRigSource, shadowCatcherSource]
      .join('\n')
      .split('\n')
      .flatMap((line) => /^uniform \w+ (u_look\w+);$/.exec(line)?.[1] ?? []);
    expect([...declared].sort()).toEqual([...LOOK_UNIFORM_NAMES].sort());
  });

  it('uploads every value of the look, the frame height and the grade switch', () => {
    const { gl, calls } = fakeGl();
    const base = LOOK_PRESETS['marketplace'] ?? DEFAULT_LOOK;
    const look = { ...base, toneMapping: { ...base.toneMapping, exposure: 0.3 } };
    uploadLookUniforms(gl, everywhere, look, 512, LOOK_VIEW_NONE);
    const value = (name: string) => calls.find(([, n]) => n === name)?.[2];
    expect(calls).toHaveLength(LOOK_UNIFORM_NAMES.length);
    expect(value('u_lookFrameHeight')).toBe(512);
    expect(value('u_lookExposureScale')).toBeCloseTo(2 ** 0.3, 12);
    expect(value('u_lookGraded')).toBe(1);
    expect(value('u_lookKeyCosRadius')).toBeCloseTo(Math.cos(look.lights.key.angularRadius), 12);
    expect(value('u_lookRimColor')).toEqual([...new Float32Array(look.lights.rim.color)]);
    expect(value('u_lookRimExponent')).toBe(look.lights.rim.exponent);
    expect(value('u_lookRimAlbedoShare')).toBe(look.lights.rim.albedoShare);
    // No camera: view space is world space, the eye far along +z.
    expect(value('u_lookRimDirection')).toEqual([...new Float32Array(look.lights.rim.direction)]);
    expect(value('u_lookEye')).toEqual([0, 0, 1, 0]);
    expect(value('u_lookBackdropTop')).toEqual([...new Float32Array(look.backdrop.top)]);
  });

  it('Studio: exposure scale exactly 1, the grade skipped', () => {
    const { gl, calls } = fakeGl();
    uploadLookUniforms(gl, everywhere, DEFAULT_LOOK, 256, LOOK_VIEW_NONE);
    expect(calls.find(([, n]) => n === 'u_lookExposureScale')?.[2]).toBe(1);
    expect(calls.find(([, n]) => n === 'u_lookGraded')?.[2]).toBe(0);
  });

  it('skips uniforms the program has no location for', () => {
    const { gl, calls } = fakeGl();
    const only = new Set<string>(['u_lookSky', 'u_lookGraded']);
    uploadLookUniforms(gl, (name) => (only.has(name) ? everywhere(name) : null), DEFAULT_LOOK, 256, LOOK_VIEW_NONE);
    expect(calls.map(([, name]) => name)).toEqual(['u_lookSky', 'u_lookGraded']);
  });

  it('turns the rim into world space by the view of each call, the same look packed once', () => {
    const look = LOOK_PRESETS['marketplace'] ?? DEFAULT_LOOK;
    const views = [
      lookView({ position: [0, 0, 40], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], orthographic: false }),
      lookView({ position: [0, 0, -40], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], orthographic: true }),
    ];
    const seen = views.map((view) => {
      const { gl, calls } = fakeGl();
      uploadLookUniforms(gl, everywhere, look, 256, view);
      const value = (name: string) => calls.find(([, n]) => n === name)?.[2];
      expect(value('u_lookRimDirection')).toEqual([
        ...new Float32Array(rimWorldDirection(look.lights.rim.direction, view)),
      ]);
      return { direction: value('u_lookRimDirection') as number[], eye: value('u_lookEye') };
    });
    expect(seen[0]?.eye).toEqual([0, 0, 40, 1]);
    expect(seen[1]?.eye).toEqual([-0, -0, -1, 0]); // back = minus forward
    // Turned half round about y: the world x and z of the rim flip, y stays.
    expect(seen[1]?.direction[0]).toBeCloseTo(-(seen[0]?.direction[0] ?? 0), 6);
    expect(seen[1]?.direction[1]).toBeCloseTo(seen[0]?.direction[1] ?? 0, 6);
    expect(seen[1]?.direction[2]).toBeCloseTo(-(seen[0]?.direction[2] ?? 0), 6);
  });
});
