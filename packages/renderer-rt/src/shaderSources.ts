import { linkShader, lookShaderChunks, type ShaderChunks } from '@modelshot/looks';
import type { DepthKeyMode } from './depthKeyMode';
import backdropFrag from './shaders/backdrop.frag.glsl?raw';
import bakedLight from './shaders/bakedLight.glsl?raw';
import catcherFrag from './shaders/catcher.frag.glsl?raw';
import catcherVert from './shaders/catcher.vert.glsl?raw';
import depthKeyExact from './shaders/depthKeyExact.glsl?raw';
import depthKeyVertexExact from './shaders/depthKeyVertexExact.glsl?raw';
import depthKeyVertexRaster from './shaders/depthKeyVertexRaster.glsl?raw';
import depthKeyRaster from './shaders/depthKeyRaster.glsl?raw';
import fallbackFrag from './shaders/fallback.frag.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import hashAlpha from './shaders/hashAlpha.glsl?raw';
import lerpExact from './shaders/lerpExact.glsl?raw';
import meshVert from './shaders/mesh.vert.glsl?raw';
import oitAccumFrag from './shaders/oitAccum.frag.glsl?raw';
import oitCompositeFrag from './shaders/oitComposite.frag.glsl?raw';
import opaqueFrag from './shaders/opaque.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import presentSamplesFrag from './shaders/presentSamples.frag.glsl?raw';
import viewport from './shaders/viewport.glsl?raw';
import shading from './shaders/shading.glsl?raw';
import texelFilterLinear from './shaders/texelFilterLinear.glsl?raw';
import texelFilterNearest from './shaders/texelFilterNearest.glsl?raw';
import texelSample from './shaders/texelSample.glsl?raw';

export type ShaderProgramName =
  'opaque' | 'oitAccum' | 'oitComposite' | 'present' | 'presentSamples' | 'fallback' | 'backdrop' | 'catcher';

/**
 * The texture filter a mesh-pass program is linked for (`#include "texelFilterColor"` of texelSample.glsl): a draw
 * whose texture carries TEXTURE_FLAG_LINEAR takes `linear`, every other one `nearest`, which holds no linear code. With
 * the linear filter behind a branch on the flags in every program, SwiftShader drew the 512 px bench frame of nearest
 * textures about 1.25x slower (MS-90).
 */
export type TexelFilterVariant = 'nearest' | 'linear';

export interface ShaderProgramSource {
  readonly vertex: string;
  readonly fragment: string;
}

/** The renderer's own chunks plus the shared look chunks, with the nearest texel filter; static sources only. */
export const RENDERER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  texelSample,
  texelFilterColor: texelFilterNearest,
  shading,
  viewport,
  hashAlpha,
  bakedLight,
  lerpExact,
});

/** `#include "depthKey"` (fragment) and `#include "depthKeyVertex"` per depth-key variant of the mesh passes. */
const DEPTH_KEY_CHUNKS: Readonly<Record<DepthKeyMode, ShaderChunks>> = {
  raster: { depthKey: depthKeyRaster, depthKeyVertex: depthKeyVertexRaster },
  exact: { depthKey: depthKeyExact, depthKeyVertex: depthKeyVertexExact },
};

/** `#include "texelFilterColor"` per texel-filter variant of the mesh passes. */
const TEXEL_FILTER_CHUNKS: Readonly<Record<TexelFilterVariant, string>> = {
  nearest: texelFilterNearest,
  linear: texelFilterLinear,
};

const PROGRAMS: Readonly<Record<ShaderProgramName, readonly [string, string]>> = {
  opaque: [meshVert, opaqueFrag],
  oitAccum: [meshVert, oitAccumFrag],
  oitComposite: [fullscreenVert, oitCompositeFrag],
  present: [fullscreenVert, presentFrag],
  presentSamples: [fullscreenVert, presentSamplesFrag],
  fallback: [meshVert, fallbackFrag],
  backdrop: [fullscreenVert, backdropFrag],
  catcher: [catcherVert, catcherFrag],
};

/**
 * Linked GLSL of one program; mesh passes come in a `raster` (default) and an `exact` depth-key variant, and in a
 * `nearest` (default) and a `linear` texel-filter variant. The other programs read no texture texels, so the filter
 * leaves them as they are.
 */
export function shaderProgramSource(
  name: ShaderProgramName,
  depthKey: DepthKeyMode = 'raster',
  filter: TexelFilterVariant = 'nearest',
): ShaderProgramSource {
  const [vertex, fragment] = PROGRAMS[name];
  const chunks: ShaderChunks = {
    ...RENDERER_SHADER_CHUNKS,
    ...DEPTH_KEY_CHUNKS[depthKey],
    texelFilterColor: TEXEL_FILTER_CHUNKS[filter],
  };
  return { vertex: linkShader(vertex, chunks), fragment: linkShader(fragment, chunks) };
}
