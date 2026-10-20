import { linkShader, lookShaderChunks, type ShaderChunks } from '@modelshot/looks';
import bvhTraverse from './shaders/bvhTraverse.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import primaryRay from './shaders/primaryRay.glsl?raw';
import rng from './shaders/rng.glsl?raw';
import sceneData from './shaders/sceneData.glsl?raw';
import surfaceHit from './shaders/surfaceHit.glsl?raw';
import traceFrag from './shaders/trace.frag.glsl?raw';

/** The path tracer's chunks plus the shared look chunks (alpha rule, face texels, light rig, AgX); static only. */
export const PATH_TRACER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  rng,
  sceneData,
  primaryRay,
  surfaceHit,
  bvhTraverse,
});

export type PathTracerProgramName = 'trace' | 'present';

const PROGRAMS: Readonly<Record<PathTracerProgramName, readonly [string, string]>> = {
  trace: [fullscreenVert, traceFrag],
  present: [fullscreenVert, presentFrag],
};

/** Linked GLSL of one program. */
export function pathTracerProgramSource(name: PathTracerProgramName): { vertex: string; fragment: string } {
  const [vertex, fragment] = PROGRAMS[name];
  return {
    vertex: linkShader(vertex, PATH_TRACER_SHADER_CHUNKS),
    fragment: linkShader(fragment, PATH_TRACER_SHADER_CHUNKS),
  };
}
