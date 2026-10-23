import { describe, expect, it } from 'vitest';
import { NOISE_BLOCK, ResolveTargets, type ResolveLayout } from '../src/resolveTargets';
import { stubGl } from './stubGl';

const LAYOUT: ResolveLayout = {
  width: 64,
  height: 48,
  outputWidth: 32,
  outputHeight: 24,
  denoise: true,
  resolve: true,
  noise: true,
  transparent: false,
};

/** The internal formats of the 2D textures allocated at width x height. */
function formatsAt(calls: ReturnType<typeof stubGl>['calls'], width: number, height: number): unknown[] {
  return calls
    .filter((c) => c.name === 'texStorage2D' && c.args[3] === width && c.args[4] === height)
    .map((c) => c.args[2]);
}

describe('ResolveTargets', () => {
  it('keeps the guides in RGBA16F and the filter images in RGBA32F at the traced size', () => {
    const { gl, calls } = stubGl();
    const targets = new ResolveTargets(gl, LAYOUT);
    // Guides albedo and normal, then the two filter images: a sample's variance over a floored albedo overflows half.
    expect(formatsAt(calls, 64, 48)).toEqual([gl.RGBA16F, gl.RGBA16F, gl.RGBA32F, gl.RGBA32F]);
    expect(formatsAt(calls, 32, 24)).toEqual([gl.RGBA32F]);
    expect(formatsAt(calls, 32 / NOISE_BLOCK, 24 / NOISE_BLOCK)).toEqual([gl.RGBA32F]);
    expect(targets.filtered).not.toBeNull();
  });

  it('gives each filter image an R32F coverage image at attachment 1 when denoising a transparent request', () => {
    const { gl, calls } = stubGl();
    const targets = new ResolveTargets(gl, { ...LAYOUT, transparent: true });
    expect(formatsAt(calls, 64, 48)).toEqual([gl.RGBA16F, gl.RGBA16F, gl.RGBA32F, gl.R32F, gl.RGBA32F, gl.R32F]);
    expect(targets.filtered?.every((f) => f.coverage !== null)).toBe(true);
    const attached = calls.filter((c) => c.name === 'framebufferTexture2D' && c.args[1] === gl.COLOR_ATTACHMENT0 + 1);
    expect(attached.map((c) => c.args[3])).toContain(targets.filtered?.[0].coverage);
    expect(new ResolveTargets(gl, LAYOUT).filtered?.every((f) => f.coverage === null)).toBe(true);
  });

  it('allocates only what the layout asks for and deletes all of it', () => {
    const { gl, calls } = stubGl();
    const targets = new ResolveTargets(gl, { ...LAYOUT, denoise: false, noise: false });
    expect(targets.guide).toBeNull();
    expect(targets.filtered).toBeNull();
    expect(targets.noise).toBeNull();
    expect(calls.filter((c) => c.name === 'texStorage2D')).toHaveLength(1);
    targets.dispose();
    expect(calls.filter((c) => c.name === 'deleteTexture')).toHaveLength(1);
    expect(calls.filter((c) => c.name === 'deleteFramebuffer')).toHaveLength(1);
  });
});
