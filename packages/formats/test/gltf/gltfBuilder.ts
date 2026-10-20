/** Builds small glTF documents in tests: geometry goes into one embedded buffer, everything else is plain JSON. */

export interface TestPrimitive {
  readonly positions: readonly number[];
  readonly normals?: readonly number[];
  readonly uvs?: readonly number[];
  /** `TEXCOORD_1`. */
  readonly uvs1?: readonly number[];
  readonly indices?: readonly number[];
  readonly mode?: number;
  readonly material?: number;
  /** Extra primitive properties (targets, extensions, …). */
  readonly extra?: Record<string, unknown>;
  /** Extra attributes, each an accessor index or a float VEC4 array. */
  readonly attributes?: Record<string, readonly number[]>;
}

export type Json = Record<string, unknown>;

/** A triangle in the XY plane, counter-clockwise seen from +Z. */
export const TRIANGLE: TestPrimitive = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 1, 1, 1, 0, 0],
};

export interface DocOptions {
  /** Primitives per mesh; default one mesh with `TRIANGLE`. */
  readonly meshes?: readonly (readonly TestPrimitive[])[];
  /** Default: one node per mesh, all scene roots. */
  readonly nodes?: readonly Json[];
  /** Default: one scene with every node that is no child. */
  readonly scenes?: readonly Json[] | null;
  readonly materials?: readonly Json[];
  readonly textures?: readonly Json[];
  readonly images?: readonly Json[];
  readonly samplers?: readonly Json[];
  readonly extra?: Json;
}

export function gltfDoc(options: DocOptions = {}): Json {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const accessors: Json[] = [];
  const bufferViews: Json[] = [];
  const add = (bytes: Uint8Array, accessor: Json): number => {
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.byteLength });
    chunks.push(bytes);
    length += bytes.byteLength;
    const pad = (4 - (length % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      length += pad;
    }
    accessors.push({ bufferView: bufferViews.length - 1, ...accessor });
    return accessors.length - 1;
  };
  const floats = (values: readonly number[], type: string, components: number): number =>
    add(new Uint8Array(new Float32Array(values).buffer), {
      componentType: 5126,
      count: values.length / components,
      type,
    });
  const meshes = (options.meshes ?? [[TRIANGLE]]).map((primitives, m) => ({
    name: `mesh${m}`,
    primitives: primitives.map((p) => {
      const attributes: Json = { POSITION: floats(p.positions, 'VEC3', 3) };
      if (p.normals) attributes.NORMAL = floats(p.normals, 'VEC3', 3);
      if (p.uvs) attributes.TEXCOORD_0 = floats(p.uvs, 'VEC2', 2);
      if (p.uvs1) attributes.TEXCOORD_1 = floats(p.uvs1, 'VEC2', 2);
      for (const [name, values] of Object.entries(p.attributes ?? {})) attributes[name] = floats(values, 'VEC4', 4);
      const primitive: Json = { attributes };
      if (p.indices) {
        primitive.indices = add(new Uint8Array(new Uint32Array(p.indices).buffer), {
          componentType: 5125,
          count: p.indices.length,
          type: 'SCALAR',
        });
      }
      if (p.mode !== undefined) primitive.mode = p.mode;
      if (p.material !== undefined) primitive.material = p.material;
      return { ...primitive, ...p.extra };
    }),
  }));
  const nodes: readonly Json[] = options.nodes ?? meshes.map((_, m) => ({ name: `node${m}`, mesh: m }));
  const children = new Set(nodes.flatMap((node) => (node.children as number[] | undefined) ?? []));
  const scenes =
    options.scenes === undefined ? [{ nodes: nodes.map((_, i) => i).filter((i) => !children.has(i)) }] : options.scenes;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const doc: Json = {
    asset: { version: '2.0' },
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: length, uri: `data:application/octet-stream;base64,${base64(bytes)}` }],
  };
  if (scenes !== null) doc.scenes = scenes;
  if (options.materials) doc.materials = options.materials;
  if (options.textures) doc.textures = options.textures;
  if (options.images) doc.images = options.images;
  if (options.samplers) doc.samplers = options.samplers;
  return { ...doc, ...options.extra };
}

export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function pngDataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${base64(bytes)}`;
}

/**
 * The same document as a GLB: buffer 0's embedded data moves into the BIN chunk (its `uri` dropped), the JSON chunk is
 * padded with spaces and the BIN chunk with zeros to 4 bytes, as the GLB spec asks.
 */
export function toGlb(doc: Json): Uint8Array {
  const buffers = (doc.buffers as Json[] | undefined) ?? [];
  const first = buffers[0];
  let bin: Uint8Array | null = null;
  let json: Json = doc;
  if (first && typeof first.uri === 'string' && first.uri.startsWith('data:')) {
    bin = fromBase64(first.uri.slice(first.uri.indexOf(',') + 1));
    const rest = { ...first };
    delete rest.uri;
    json = { ...doc, buffers: [rest, ...buffers.slice(1)] };
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.byteLength / 4) * 4;
  const binLength = bin ? Math.ceil(bin.byteLength / 4) * 4 : 0;
  const total = 12 + 8 + jsonLength + (bin ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  if (bin) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out;
}
