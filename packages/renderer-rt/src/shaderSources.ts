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
import meshVert from './shaders/mesh.vert.glsl?raw';
import oitAccumFrag from './shaders/oitAccum.frag.glsl?raw';
import oitCompositeFrag from './shaders/oitComposite.frag.glsl?raw';
import opaqueFrag from './shaders/opaque.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import viewport from './shaders/viewport.glsl?raw';
import shading from './shaders/shading.glsl?raw';
import silhouetteExact from './shaders/silhouetteExact.glsl?raw';
import silhouetteRaster from './shaders/silhouetteRaster.glsl?raw';
import silhouetteVertexExact from './shaders/silhouetteVertexExact.glsl?raw';
import silhouetteVertexRaster from './shaders/silhouetteVertexRaster.glsl?raw';
import texelSample from './shaders/texelSample.glsl?raw';
import triangleCorners from './shaders/triangleCorners.glsl?raw';
import triangleCornersVertex from './shaders/triangleCornersVertex.glsl?raw';

export type ShaderProgramName =
  'opaque' | 'oitAccum' | 'oitComposite' | 'present' | 'fallback' | 'backdrop' | 'catcher';

export interface ShaderProgramSource {
  readonly vertex: string;
  readonly fragment: string;
}

/** The renderer's own chunks plus the shared look chunks; static sources only. */
export const RENDERER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  texelSample,
  shading,
  viewport,
  hashAlpha,
  bakedLight,
  triangleCorners,
  triangleCornersVertex,
});

/**
 * `#include "depthKey"`, `"silhouette"` (fragment) and `"depthKeyVertex"`, `"silhouetteVertex"` per depth-key variant
 * of the mesh passes; exact frames are single-sampled, so their silhouette chunks are stubs.
 */
const DEPTH_KEY_CHUNKS: Readonly<Record<DepthKeyMode, ShaderChunks>> = {
  raster: Object.freeze({
    ...RENDERER_SHADER_CHUNKS,
    depthKey: depthKeyRaster,
    depthKeyVertex: depthKeyVertexRaster,
    silhouette: silhouetteRaster,
    silhouetteVertex: silhouetteVertexRaster,
  }),
  exact: Object.freeze({
    ...RENDERER_SHADER_CHUNKS,
    depthKey: depthKeyExact,
    depthKeyVertex: depthKeyVertexExact,
    silhouette: silhouetteExact,
    silhouetteVertex: silhouetteVertexExact,
  }),
};

const PROGRAMS: Readonly<Record<ShaderProgramName, readonly [string, string]>> = {
  opaque: [meshVert, opaqueFrag],
  oitAccum: [meshVert, oitAccumFrag],
  oitComposite: [fullscreenVert, oitCompositeFrag],
  present: [fullscreenVert, presentFrag],
  fallback: [meshVert, fallbackFrag],
  backdrop: [fullscreenVert, backdropFrag],
  catcher: [catcherVert, catcherFrag],
};

/** Linked GLSL of one program; mesh passes come in a `raster` (default) and an `exact` depth-key variant. */
export function shaderProgramSource(name: ShaderProgramName, depthKey: DepthKeyMode = 'raster'): ShaderProgramSource {
  const [vertex, fragment] = PROGRAMS[name];
  const chunks = DEPTH_KEY_CHUNKS[depthKey];
  return { vertex: linkShader(vertex, chunks), fragment: linkShader(fragment, chunks) };
}
