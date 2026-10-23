import { loadBbmodel } from '@modelshot/formats';
import { attachModel, type SceneDocument } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';
import {
  WRAP_CUBES,
  WRAP_FACE_UV,
  WRAP_SENTINEL,
  WRAP_TEXELS,
  wrapColumnColor,
  type WrapCube,
  type WrapCubeName,
} from './textureWrapLayout';

function dataUri(rgba: Uint8Array): string {
  const png = encodeRgbaPng(WRAP_TEXELS, WRAP_TEXELS, rgba);
  let binary = '';
  for (const byte of png) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

/** 16 x 16, opaque, every row alike: column c in `wrapColumnColor(c)`. */
function wrapImage(): string {
  const rgba = new Uint8Array(WRAP_TEXELS * WRAP_TEXELS * 4);
  for (let i = 0; i < WRAP_TEXELS * WRAP_TEXELS; i++) rgba.set([...wrapColumnColor(i % WRAP_TEXELS), 255], i * 4);
  return dataUri(rgba);
}

function sentinelImage(): string {
  const rgba = new Uint8Array(WRAP_TEXELS * WRAP_TEXELS * 4);
  for (let i = 0; i < WRAP_TEXELS * WRAP_TEXELS; i++) rgba.set([...WRAP_SENTINEL, 255], i * 4);
  return dataUri(rgba);
}

function texture(name: string, source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, uuid: name, uv_width: WRAP_TEXELS, uv_height: WRAP_TEXELS, source, ...extra };
}

/** A box of `cube`; its south face passes the texture, the other faces stay inside it. */
function box(cube: WrapCube, texture: number): Record<string, unknown> {
  const inside = { uv: [0, 0, 16, 4], texture };
  return {
    name: cube.name,
    type: 'cube',
    uuid: cube.name,
    box_uv: false,
    from: [-12, cube.y, -2],
    to: [12, cube.y + 8, 2],
    origin: [0, 0, 0],
    faces: {
      north: inside,
      east: inside,
      south: { uv: [...WRAP_FACE_UV], texture },
      west: inside,
      up: inside,
      down: inside,
    },
  };
}

const cubeNamed = (name: WrapCubeName): WrapCube => {
  const cube = WRAP_CUBES.find((c) => c.name === name);
  if (!cube) throw new Error(`no wrap cube ${name}`);
  return cube;
};

/**
 * The wrap scene (textureWrapLayout.ts), loaded from two .bbmodel files built here (images generated, no asset file):
 * a hytale_prop project (texture_wrap_default clamp) holding the top box under a group `stage`, and a free project with
 * the other two boxes attached to that group, one texture without wrap_mode and one stored as repeat. A sentinel image
 * follows each wrap texture, so in the path tracer's texture layers (shelf-packed in document order) it lies right of
 * it: a lookup that left its image would show it.
 */
export function textureWrapScene(): SceneDocument {
  const wrap = wrapImage();
  const sentinel = sentinelImage();
  const hytale = {
    meta: { format_version: '4.10', model_format: 'hytale_prop', box_uv: false },
    resolution: { width: WRAP_TEXELS, height: WRAP_TEXELS },
    elements: [box(cubeNamed('hytale-clamp'), 0)],
    outliner: [{ name: 'stage', uuid: 'stage', origin: [0, 0, 0], children: ['hytale-clamp'] }],
    textures: [texture('hytale', wrap, { use_as_default: true }), texture('hytale-sentinel', sentinel)],
  };
  const free = {
    meta: { format_version: '4.10', model_format: 'free', box_uv: false },
    resolution: { width: WRAP_TEXELS, height: WRAP_TEXELS },
    elements: [box(cubeNamed('free-clamp'), 0), box(cubeNamed('free-repeat'), 2)],
    outliner: ['free-clamp', 'free-repeat'],
    textures: [
      texture('clamp', wrap),
      texture('clamp-sentinel', sentinel),
      texture('repeat', wrap, { wrap_mode: 'repeat' }),
      texture('repeat-sentinel', sentinel),
    ],
  };
  const host = loadBbmodel(JSON.stringify(hytale)).scene;
  return attachModel(host, loadBbmodel(JSON.stringify(free)).scene, { bone: 'stage', name: 'free' });
}
