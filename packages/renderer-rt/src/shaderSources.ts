import { linkShader, lookShaderChunks, type ShaderChunks } from '@modelshot/looks';
import backdropFrag from './shaders/backdrop.frag.glsl?raw';
import fallbackFrag from './shaders/fallback.frag.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import hashAlpha from './shaders/hashAlpha.glsl?raw';
import meshVert from './shaders/mesh.vert.glsl?raw';
import oitAccumFrag from './shaders/oitAccum.frag.glsl?raw';
import oitCompositeFrag from './shaders/oitComposite.frag.glsl?raw';
import opaqueFrag from './shaders/opaque.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import shading from './shaders/shading.glsl?raw';
import texelSample from './shaders/texelSample.glsl?raw';

export type ShaderProgramName = 'opaque' | 'oitAccum' | 'oitComposite' | 'present' | 'fallback' | 'backdrop';

export interface ShaderProgramSource {
  readonly vertex: string;
  readonly fragment: string;
}

/** The renderer's own chunks plus the shared look chunks; static sources only. */
export const RENDERER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  texelSample,
  shading,
  hashAlpha,
});

const PROGRAMS: Readonly<Record<ShaderProgramName, readonly [string, string]>> = {
  opaque: [meshVert, opaqueFrag],
  oitAccum: [meshVert, oitAccumFrag],
  oitComposite: [fullscreenVert, oitCompositeFrag],
  present: [fullscreenVert, presentFrag],
  fallback: [meshVert, fallbackFrag],
  backdrop: [fullscreenVert, backdropFrag],
};

/** Linked GLSL of one program. */
export function shaderProgramSource(name: ShaderProgramName): ShaderProgramSource {
  const [vertex, fragment] = PROGRAMS[name];
  return {
    vertex: linkShader(vertex, RENDERER_SHADER_CHUNKS),
    fragment: linkShader(fragment, RENDERER_SHADER_CHUNKS),
  };
}
