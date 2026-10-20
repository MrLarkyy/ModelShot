import referencedPngUri from '../fixtures/bbmodel/referenced.png?inline';

const sources = import.meta.glob<string>('../fixtures/bbmodel/*.bbmodel', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const FIXTURE_NAMES = [
  'single-cube',
  'pivot-rotation',
  'nested-groups',
  'uv-rotation-mirror',
  'hi-res-texture',
  'box-uv',
  'flat-cube',
  'referenced-texture',
  'format5-groups',
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function fixture(name: FixtureName): string {
  const text = sources[`../fixtures/bbmodel/${name}.bbmodel`];
  if (text === undefined) throw new Error(`fixture ${name} not found`);
  return text;
}

export function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** `referenced.png` as the bytes a user would pick next to the model. */
export function referencedPng(): Uint8Array {
  return base64Bytes(referencedPngUri.slice(referencedPngUri.indexOf(',') + 1));
}

/** The picked files `referenced-texture` needs. */
export function fixtureTextureFiles(name: FixtureName): ReadonlyMap<string, Uint8Array> | undefined {
  return name === 'referenced-texture' ? new Map([['referenced.png', referencedPng()]]) : undefined;
}

/** A PNG signature and IHDR chunk claiming `width` × `height`; enough for the header check, no image data. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export function pngDataUri(width: number, height: number): string {
  return `data:image/png;base64,${btoa(String.fromCharCode(...pngHeader(width, height)))}`;
}

/** A minimal valid model; `extra` replaces top-level keys. */
export function model(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: { format_version: '4.5', model_format: 'free', box_uv: false },
    resolution: { width: 16, height: 16 },
    elements: [cube()],
    outliner: ['c0'],
    textures: [],
    ...extra,
  };
}

/** A 1×1×1 cube with all six faces untextured; `extra` replaces keys. */
export function cube(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const face = { uv: [0, 0, 1, 1], texture: null };
  return {
    name: 'cube',
    type: 'cube',
    uuid: 'c0',
    from: [0, 0, 0],
    to: [1, 1, 1],
    origin: [0, 0, 0],
    faces: { north: face, east: face, south: face, west: face, up: face, down: face },
    ...extra,
  };
}
