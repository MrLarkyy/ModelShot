import { linkShader, lookShaderChunks, type ShaderChunks } from '@modelshot/looks';
import bakeFrag from './shaders/bake.frag.glsl?raw';
import bvhTraverse from './shaders/bvhTraverse.glsl?raw';
import cameraCatcher from './shaders/cameraCatcher.glsl?raw';
import denoiseFrag from './shaders/denoise.frag.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import guideFrag from './shaders/guide.frag.glsl?raw';
import keyLight from './shaders/keyLight.glsl?raw';
import luminanceMoments from './shaders/luminanceMoments.glsl?raw';
import noiseFrag from './shaders/noise.frag.glsl?raw';
import pathSampling from './shaders/pathSampling.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import primaryRay from './shaders/primaryRay.glsl?raw';
import resolveFrag from './shaders/resolve.frag.glsl?raw';
import rng from './shaders/rng.glsl?raw';
import sceneData from './shaders/sceneData.glsl?raw';
import surfaceHit from './shaders/surfaceHit.glsl?raw';
import traceFrag from './shaders/trace.frag.glsl?raw';

/** The path tracer's chunks plus the shared look chunks (alpha rule, face texels, light rig, AgX); static only. */
export const PATH_TRACER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  rng,
  pathSampling,
  keyLight,
  sceneData,
  primaryRay,
  surfaceHit,
  bvhTraverse,
  cameraCatcher,
  luminanceMoments,
});

export type PathTracerProgramName = 'trace' | 'present' | 'bake' | 'guide' | 'denoise' | 'resolve' | 'noise';

const PROGRAMS: Readonly<Record<PathTracerProgramName, readonly [string, string]>> = {
  trace: [fullscreenVert, traceFrag],
  present: [fullscreenVert, presentFrag],
  bake: [fullscreenVert, bakeFrag],
  guide: [fullscreenVert, guideFrag],
  denoise: [fullscreenVert, denoiseFrag],
  resolve: [fullscreenVert, resolveFrag],
  noise: [fullscreenVert, noiseFrag],
};

/** Linked GLSL of one program. */
export function pathTracerProgramSource(name: PathTracerProgramName): { vertex: string; fragment: string } {
  const [vertex, fragment] = PROGRAMS[name];
  return {
    vertex: linkShader(vertex, PATH_TRACER_SHADER_CHUNKS),
    fragment: linkShader(fragment, PATH_TRACER_SHADER_CHUNKS),
  };
}
