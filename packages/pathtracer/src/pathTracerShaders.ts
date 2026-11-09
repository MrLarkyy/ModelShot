import { linkShader, type ShaderChunks } from '@modelshot/looks';
import { BAKE_SHADER_CHUNKS, bakeProgramSource } from './bakeProgramSource';
import cameraCatcher from './shaders/cameraCatcher.glsl?raw';
import catcherFill from './shaders/catcherFill.glsl?raw';
import denoiseFrag from './shaders/denoise.frag.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import guideFrag from './shaders/guide.frag.glsl?raw';
import luminanceMoments from './shaders/luminanceMoments.glsl?raw';
import noiseFrag from './shaders/noise.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';
import primaryRay from './shaders/primaryRay.glsl?raw';
import resolveFrag from './shaders/resolve.frag.glsl?raw';
import traceFrag from './shaders/trace.frag.glsl?raw';

/** The path tracer's chunks plus the shared look chunks (alpha rule, face texels, light rig, AgX); static only. */
export const PATH_TRACER_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...BAKE_SHADER_CHUNKS,
  primaryRay,
  cameraCatcher,
  catcherFill,
  luminanceMoments,
});

export type PathTracerProgramName = 'trace' | 'present' | 'bake' | 'guide' | 'denoise' | 'resolve' | 'noise';

const PROGRAMS: Readonly<Record<Exclude<PathTracerProgramName, 'bake'>, readonly [string, string]>> = {
  trace: [fullscreenVert, traceFrag],
  present: [fullscreenVert, presentFrag],
  guide: [fullscreenVert, guideFrag],
  denoise: [fullscreenVert, denoiseFrag],
  resolve: [fullscreenVert, resolveFrag],
  noise: [fullscreenVert, noiseFrag],
};

/** Linked GLSL of one program (the bake's from `bakeProgramSource`). */
export function pathTracerProgramSource(name: PathTracerProgramName): { vertex: string; fragment: string } {
  if (name === 'bake') return bakeProgramSource();
  const [vertex, fragment] = PROGRAMS[name];
  return {
    vertex: linkShader(vertex, PATH_TRACER_SHADER_CHUNKS),
    fragment: linkShader(fragment, PATH_TRACER_SHADER_CHUNKS),
  };
}
