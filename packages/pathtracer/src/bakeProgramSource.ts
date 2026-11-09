import { linkShader, lookShaderChunks, type ShaderChunks } from '@modelshot/looks';
import bakeFrag from './shaders/bake.frag.glsl?raw';
import bvhTraverse from './shaders/bvhTraverse.glsl?raw';
import environmentMap from './shaders/environmentMap.glsl?raw';
import fullscreenVert from './shaders/fullscreen.vert.glsl?raw';
import keyLight from './shaders/keyLight.glsl?raw';
import pathSampling from './shaders/pathSampling.glsl?raw';
import rng from './shaders/rng.glsl?raw';
import sceneData from './shaders/sceneData.glsl?raw';
import surfaceHit from './shaders/surfaceHit.glsl?raw';

/**
 * The chunks the light bake links (the shared look chunks plus the scene, traversal and sampling ones); the render's
 * programs add theirs on top (`PATH_TRACER_SHADER_CHUNKS`). Static only.
 */
export const BAKE_SHADER_CHUNKS: ShaderChunks = Object.freeze({
  ...lookShaderChunks,
  rng,
  environmentMap,
  pathSampling,
  keyLight,
  sceneData,
  surfaceHit,
  bvhTraverse,
});

/**
 * Linked GLSL of the light bake's program. Apart from the render's programs, so the baker, alone in the preview, the
 * embed frame and their workers, ships none of the render's shader sources.
 */
export function bakeProgramSource(): { vertex: string; fragment: string } {
  return { vertex: linkShader(fullscreenVert, BAKE_SHADER_CHUNKS), fragment: linkShader(bakeFrag, BAKE_SHADER_CHUNKS) };
}
