import { loadBbmodel } from '@modelshot/formats';
import { attachModel, type SceneDocument } from '@modelshot/scene';
import { encodeRgbaPng } from './encodeRgbaPng';
import {
  STRIP_FRAME_ROWS,
  WRAP_SENTINEL,
  WRAP_TEXELS,
  stripRowColor,
  wrapColumnColor,
  wrapCube,
  type WrapCubeName,
} from './textureWrapLayout';

type Rgb = readonly [number, number, number];

/** A 16 x 16 opaque PNG data URI, texel (x, y) in `color(x, y)`. */
function image(color: (x: number, y: number) => Rgb): string {
  const rgba = new Uint8Array(WRAP_TEXELS * WRAP_TEXELS * 4);
  for (let i = 0; i < WRAP_TEXELS * WRAP_TEXELS; i++) {
    rgba.set([...color(i % WRAP_TEXELS, Math.floor(i / WRAP_TEXELS)), 255], i * 4);
  }
  const png = encodeRgbaPng(WRAP_TEXELS, WRAP_TEXELS, rgba);
  let binary = '';
  for (const byte of png) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function texture(name: string, source: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, uuid: name, uv_width: WRAP_TEXELS, uv_height: WRAP_TEXELS, source, ...extra };
}

/** The box `name` (textureWrapLayout.ts); its south face passes the texture, the other faces stay inside it. */
function box(name: WrapCubeName, texture: number): Record<string, unknown> {
  const cube = wrapCube(name);
  const inside = { uv: [0, 0, 16, 4], texture };
  return {
    name,
    type: 'cube',
    uuid: name,
    box_uv: false,
    from: [cube.x[0], cube.y[0], -2],
    to: [cube.x[1], cube.y[1], 2],
    origin: [0, 0, 0],
    faces: {
      north: inside,
      east: inside,
      south: { uv: [...cube.uv], texture },
      west: inside,
      up: inside,
      down: inside,
    },
  };
}

/**
 * The wrap scene (textureWrapLayout.ts), loaded from two .bbmodel files built here (images generated, no asset file):
 * a hytale_prop project (texture_wrap_default clamp) holding its box under a group `stage`, and a free project with
 * the other boxes attached to that group: still textures without wrap_mode and stored as repeat, and the same for a
 * two-frame strip (an image twice as tall as its UV space, so the loader reads frames). A sentinel image follows each
 * still wrap texture, so in the path tracer's texture layers (shelf-packed in document order) it lies right of it; the
 * strip's frame 1 is the sentinel too. A lookup that left its image or frame would show it.
 */
export function textureWrapScene(): SceneDocument {
  const still = image((x) => wrapColumnColor(x));
  const sentinel = image(() => WRAP_SENTINEL);
  const strip = image((_, y) => (y < STRIP_FRAME_ROWS ? stripRowColor(y) : WRAP_SENTINEL));
  const stripTexture = (name: string, extra: Record<string, unknown> = {}) =>
    texture(name, strip, { uv_height: STRIP_FRAME_ROWS, ...extra });
  const hytale = {
    meta: { format_version: '4.10', model_format: 'hytale_prop', box_uv: false },
    resolution: { width: WRAP_TEXELS, height: WRAP_TEXELS },
    elements: [box('hytale-clamp', 0)],
    outliner: [{ name: 'stage', uuid: 'stage', origin: [0, 0, 0], children: ['hytale-clamp'] }],
    textures: [texture('hytale', still, { use_as_default: true }), texture('hytale-sentinel', sentinel)],
  };
  const free = {
    meta: { format_version: '4.10', model_format: 'free', box_uv: false },
    resolution: { width: WRAP_TEXELS, height: WRAP_TEXELS },
    elements: [box('free-clamp', 0), box('free-repeat', 2), box('strip-clamp', 4), box('strip-repeat', 5)],
    outliner: ['free-clamp', 'free-repeat', 'strip-clamp', 'strip-repeat'],
    textures: [
      texture('clamp', still),
      texture('clamp-sentinel', sentinel),
      texture('repeat', still, { wrap_mode: 'repeat' }),
      texture('repeat-sentinel', sentinel),
      stripTexture('strip-clamp'),
      stripTexture('strip-repeat', { wrap_mode: 'repeat' }),
    ],
  };
  const host = loadBbmodel(JSON.stringify(hytale)).scene;
  return attachModel(host, loadBbmodel(JSON.stringify(free)).scene, { bone: 'stage', name: 'free' });
}
