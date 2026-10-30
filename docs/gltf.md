# glTF / GLB loader

```ts
import { loadGltf, GltfError } from '@modelshot/formats';

const { scene, warnings } = loadGltf(fileBytesOrText, {
  files: new Map([
    ['model.bin', binBytes],
    ['textures/skin.png', pngBytes],
  ]), // optional: files picked next to a .gltf
  limits: { maxTriangles: 100_000 }, // optional: overrides of DEFAULT_GLTF_LIMITS
  unitScale: 16, // optional: scene units per glTF unit (default DEFAULT_GLTF_UNIT_SCALE)
});
```

`loadGltf(input: string | Uint8Array, options?)` loads a glTF 2.0 model, as `.gltf` (JSON text or its bytes) or `.glb`
(binary container, recognised by its `glTF` magic), into a [scene format v1](scene-format.md) document plus a list of
warnings. It is synchronous and bounded: every count, size and depth is checked against a limit before anything
proportional to it is allocated or decoded, and no URL is ever fetched. It throws only `GltfError` (and a
`RangeError` for invalid `options`). `detectModelFormat(fileName, head)` tells `.gltf`, `.glb`, `.obj` and `.bbmodel`
apart (the GLB magic wins over the name); `ACCEPTED_MODEL_EXTENSIONS` and `ACCEPTED_RESOURCE_EXTENSIONS` list what a
file picker should accept.

## Supported

- glTF 2.0 (`asset.version` 2.x, `asset.minVersion` at most 2.0); `.gltf` with `data:` URIs or picked files (or, in
  the embed, files downloaded from next to the model URL: [Embed](embed.md#models-with-several-files)), `.glb` with
  its BIN chunk as buffer 0.
- **Static meshes**: `TRIANGLES`, `TRIANGLE_STRIP` and `TRIANGLE_FAN` primitives (strips and fans become lists),
  indexed (`UNSIGNED_BYTE`, `UNSIGNED_SHORT`, `UNSIGNED_INT`) or not; `POSITION` and `NORMAL` as float `VEC3`;
  `TEXCOORD_n` as float or normalized unsigned byte/short `VEC2`; interleaved buffer views (`byteStride`).
- **Nodes** of the active scene (`scene`, else scene 0): `children`, `matrix` or `translation` / `rotation` /
  `scale`, `mesh`, `name`. A mesh used by several nodes is loaded once per node.
- **Materials**: `pbrMetallicRoughness.baseColorTexture` (PNG) or `baseColorFactor`, `alphaMode` (`OPAQUE`, `MASK`
  with `alphaCutoff`, `BLEND`), `doubleSided`; `KHR_texture_transform` (offset, rotation, scale, texCoord) on the base
  colour texture.
- **Texture filter** (MS-38) from the texture's sampler: `magFilter` `LINEAR` (9729), or no `magFilter` and a linear
  `minFilter` (`LINEAR`, `LINEAR_MIPMAP_NEAREST`, `NEAREST_MIPMAP_LINEAR`, `LINEAR_MIPMAP_LINEAR`), gives the scene
  texture `filter: "linear"`: both renderers blend the colour of the four texels around a point, its alpha coverage
  stays per texel (docs/scene-format.md, Textures). Everything else is nearest, the pixel-art default: `magFilter`
  `NEAREST`, no sampler, a sampler without filters; such a texture carries no `filter` key, so a pixel-art file loads
  exactly as before. The magnification filter decides, being where the two differ on screen; there are no mipmaps,
  both modes average texels when minified. One image used through a nearest and a linear sampler becomes two scene
  textures sharing its bytes. A missing image stays nearest (its placeholder is drawn crisp).
- **Images**: PNG from a `data:` URI, a buffer view (GLB) or a picked file.

## Not supported (reported)

Everything here is reported, never silently dropped. The table is the loader's: `GLTF_PROPERTY_HANDLING` in
`reportUnsupported.ts` lists what happens to every property of the glTF 2.0 schema objects, and a test checks it
against the full schema key list and that each reported property has a test row.

| feature                                                                                                                                               | result                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `skins`, `node.skin`, `JOINTS_n` / `WEIGHTS_n`                                                                                                        | warning `UNSUPPORTED_SKIN`; meshes are drawn unskinned (rest pose)    |
| `primitive.targets`, `mesh.weights`, `node.weights`                                                                                                   | warning `UNSUPPORTED_MORPH_TARGETS`; the base geometry is drawn       |
| `animations`                                                                                                                                          | warning `UNSUPPORTED_ANIMATION`                                       |
| `cameras`, `node.camera`                                                                                                                              | warning `UNSUPPORTED_CAMERA`                                          |
| an extension in `extensionsUsed` other than `KHR_texture_transform` (lights, material extensions, `EXT_texture_webp`, …)                              | warning `UNSUPPORTED_EXTENSION`; its data is ignored                  |
| such an extension in `extensionsRequired` (`KHR_draco_mesh_compression`, `EXT_meshopt_compression`, `KHR_mesh_quantization`, `KHR_texture_basisu`, …) | error `UNSUPPORTED_REQUIRED_EXTENSION`                                |
| `metallicFactor` / `roughnessFactor` ≠ 1, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`, `emissiveTexture`, `emissiveFactor` ≠ 0    | warning `UNSUPPORTED_MATERIAL_FEATURE`, one per material listing them |
| `COLOR_n` vertex colours                                                                                                                              | warning `UNSUPPORTED_ATTRIBUTE`; not drawn                            |
| a strip, fan or list with no triangle (fewer than 3 elements)                                                                                         | warning `EMPTY_PRIMITIVE`; the primitive is skipped                   |
| `POINTS`, `LINES`, `LINE_LOOP`, `LINE_STRIP`                                                                                                          | warning `UNSUPPORTED_PRIMITIVE_MODE`; the primitive is skipped        |
| a `sparse` accessor used by a primitive                                                                                                               | warning `UNSUPPORTED_SPARSE_ACCESSOR`; the primitive is skipped       |
| more than one scene                                                                                                                                   | warning `EXTRA_SCENES_IGNORED`; only the active scene is drawn        |
| no scene                                                                                                                                              | warning `NO_SCENE`; every root node is drawn                          |
| `magFilter` `NEAREST` with a linear `minFilter`                                                                                                       | warning `TEXTURE_FILTER_NEAREST`, once per sampler; drawn nearest     |
| `REPEAT` / `MIRRORED_REPEAT` wrapping with UVs outside 0..1                                                                                           | warning `UV_WRAP_CLAMPED`; the renderers clamp at the texture edge    |
| an image that is not PNG (JPEG, WebP, KTX2) or has a broken PNG header                                                                                | warning `UNSUPPORTED_IMAGE`; the texture is `missing`                 |
| `baseColorFactor` ≠ white beside a texture                                                                                                            | warning `BASE_COLOR_FACTOR_IGNORED`; the texture is drawn as it is    |
| `matrix` together with `translation` / `rotation` / `scale`                                                                                           | warning `INVALID_TRANSFORM`; the matrix is used                       |
| an image whose file was not picked, or a URL                                                                                                          | warning `MISSING_RESOURCE`; the texture is `missing`                  |
| a textured material without its `TEXCOORD_n`                                                                                                          | warning `MISSING_TEXCOORD`; every vertex samples texel (0, 0)         |
| a node transform that flattens space (determinant ≈ 0)                                                                                                | warning `DEGENERATE_TRANSFORM`; the node's mesh is skipped            |

Ignored without a warning, because the scene cannot show them: names of scenes, accessors, buffers and samplers,
`extras`, accessor `min` / `max`, `bufferView.target`, `asset.generator` / `copyright`, `TANGENT` (only used by normal
maps, which are reported) and `TEXCOORD_n` sets no material reads.

## Conversion

- **Units and axes**: glTF is y up, right-handed, in metres, like the scene; positions are multiplied by `unitScale`
  (default 16: 1 glTF unit = 1 block = 16 scene units, the scale of Blockbench's glTF export).
- **Transforms are baked**: a `SceneNode` holds a pivot, Euler angles and a translation, so it cannot carry scale,
  shear or mirroring. Each node's world matrix (`parent · T · R · S`, or its `matrix`) is baked into the vertices of
  its mesh; the scene nodes keep the hierarchy and names with identity transforms. One `SceneMesh` per (node, glTF
  mesh), one `SceneMeshGroup` per drawn primitive, in depth-first order of the active scene. Each primitive's
  accessors are decoded once, however many nodes draw it; a mesh whose primitives were all skipped adds no `SceneMesh`.
- **Normals** go through the inverse transpose of the world matrix and are renormalised; a missing, zero or
  non-finite normal takes the face normal of the first triangle using it. A primitive without `NORMAL` is de-indexed
  and flat-shaded, as the glTF specification asks.
- **Mirroring**: under a negative determinant two corners of every triangle are swapped, so triangles stay
  counter-clockwise seen from outside and agree with their normals (the realtime renderer culls closed shells by
  winding).
- **Base colour**: a texture is used as it is (sRGB PNG, `uvWidth` × `uvHeight` = its pixel size). A material without a
  texture gets a generated 1×1 PNG of `baseColorFactor`, converted from linear to sRGB bytes (0.5 → 188), alpha × 255;
  equal colours share one texture. Preview and render show the colour through the same texture path, with no material
  field of their own. A primitive without a material keeps material −1 (the renderers' default).
- **UVs**: `KHR_texture_transform` is applied as the extension's matrix `T · R · S` (rotation rows `(cos, sin)` and
  `(−sin, cos)`: the UVs turn counter-clockwise in UV space, v down; the Khronos Sample Viewer builds the same matrix)
  and the result stored;
  each vertex's `uvRects` entry is the union of the UV bounding boxes of the triangles using it, which is the face's
  region for per-face atlas exports, so texel anti-aliasing never reaches a neighbouring region. Untextured groups use
  the centre (0.5, 0.5) and the whole image.
- **Alpha**: `OPAQUE` → `opaque`; `MASK` → `mask` with `alphaCutoff` (default 0.5); `BLEND` → `blend` with
  `BLEND_ALPHA_CUTOFF` (half an alpha step): only alpha byte 0 is invisible, every other partial texel is blended
  order-independently. `doubleSided` sets the groups' `doubleSided`.
- `source`: `{ format: 'gltf', formatVersion: asset.version, modelFormat: 'gltf' | 'glb' }`.

## Limits

Checked before allocating or decoding; override per call with `options.limits` (a positive integer or `Infinity`,
else a `RangeError`).

| limit                | default    | error                                                                                                                                                     |
| -------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxFileBytes`       | 64 MiB     | `FILE_TOO_LARGE` (bytes of the file, UTF-8 bytes of text), checked before parsing                                                                         |
| `maxNodes`           | 10 000     | `TOO_MANY_NODES` (also children of one node, scenes, root nodes of a scene)                                                                               |
| `maxMeshes`          | 10 000     | `TOO_MANY_MESHES`                                                                                                                                         |
| `maxPrimitives`      | 10 000     | `TOO_MANY_PRIMITIVES` (all meshes together)                                                                                                               |
| `maxDrawnPrimitives` | 100 000    | `TOO_MANY_PRIMITIVES` (primitives drawn, every instance counted)                                                                                          |
| `maxAccessors`       | 50 000     | `TOO_MANY_ACCESSORS` (accessors, and separately buffer views)                                                                                             |
| `maxBuffers`         | 256        | `TOO_MANY_BUFFERS`                                                                                                                                        |
| `maxMaterials`       | 256        | `TOO_MANY_MATERIALS`                                                                                                                                      |
| `maxTextures`        | 64         | `TOO_MANY_TEXTURES` (textures, and separately images and samplers)                                                                                        |
| `maxTriangles`       | 200 000    | `TOO_MANY_TRIANGLES` (every instance counted, before any geometry is decoded)                                                                             |
| `maxVertices`        | 400 000    | `TOO_MANY_VERTICES` (every instance; primitives without normals count 3 per triangle; and, separately, the POSITION vertices decoded, once per primitive) |
| `maxNesting`         | 64         | `NESTING_TOO_DEEP` (node hierarchy depth)                                                                                                                 |
| `maxTextureSide`     | 4096 px    | `TEXTURE_TOO_LARGE` (from the PNG header)                                                                                                                 |
| `maxTexturePixels`   | 16 777 216 | `TEXTURE_TOO_LARGE`                                                                                                                                       |
| `maxDataUriChars`    | 64 Mi      | `INVALID_FIELD` (length of a buffer or image `uri`)                                                                                                       |
| `maxStringChars`     | 1024       | `INVALID_FIELD` (names)                                                                                                                                   |

Every accessor is bounds-checked from the JSON (offset + stride × (count − 1) + element size within its buffer view,
the view within its buffer's declared length, in exact float64 arithmetic) before any data is read; reads go through
a `DataView`, so unaligned data is safe. The node graph is checked (indices in range, one parent per node, no cycle,
depth) and walked with an explicit stack. A GLB's chunk lengths are checked against the bytes present, so any
truncation or corrupted header fails with a `GltfError`.

## Errors

`GltfError` has a `code`, a `path` (a JSON path such as `$.accessors[3].count`, or `glb[<byte offset>]` inside the
GLB container) and a message `<what> at <path>: <detail>` quoting at most 32 characters of file content.

| code                             | when                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_TOO_LARGE`                 | the file exceeds `maxFileBytes`                                                                                                                                                                                                                                                                                                                   |
| `NOT_GLB`                        | a `glTF` magic but a broken container: short header, bad length, unaligned or overlong chunk, no JSON chunk first                                                                                                                                                                                                                                 |
| `NOT_JSON`                       | not UTF-8 or not JSON                                                                                                                                                                                                                                                                                                                             |
| `NOT_GLTF`                       | not an object, or no `asset` / `asset.version`                                                                                                                                                                                                                                                                                                    |
| `UNSUPPORTED_VERSION`            | GLB container version ≠ 2, `asset.version` not 2.x, or `asset.minVersion` above 2.0                                                                                                                                                                                                                                                               |
| `INVALID_FIELD`                  | a wrong type, a non-finite number, an index out of range, an accessor layout glTF does not allow for its attribute, a stride that is not a multiple of 4 or shorter than an element, attribute counts that differ, a triangle list count not a multiple of 3, a zero quaternion, an unknown `alphaMode`, a negative `alphaCutoff`, a bad data URI |
| `UNSUPPORTED_REQUIRED_EXTENSION` | `extensionsRequired` names an extension the loader does not implement                                                                                                                                                                                                                                                                             |
| `MISSING_BUFFER`                 | a buffer whose file was not picked (the message names it), a URL (never fetched), no BIN chunk, or fewer bytes than its `byteLength`                                                                                                                                                                                                              |
| `ACCESSOR_OUT_OF_BOUNDS`         | an accessor reads past its buffer view, or a view ends past its buffer                                                                                                                                                                                                                                                                            |
| `INDEX_OUT_OF_RANGE`             | a vertex index ≥ the primitive's vertex count                                                                                                                                                                                                                                                                                                     |
| `NODE_GRAPH_INVALID`             | a node with two parents, its own child, a cycle, or a scene root that is a child or listed twice                                                                                                                                                                                                                                                  |
| `NESTING_TOO_DEEP`               | the hierarchy is deeper than `maxNesting`                                                                                                                                                                                                                                                                                                         |
| `TOO_MANY_*`                     | a count over its limit (see Limits)                                                                                                                                                                                                                                                                                                               |
| `TEXTURE_TOO_LARGE`              | a PNG over the side or pixel limit                                                                                                                                                                                                                                                                                                                |
| `NON_FINITE_DATA`                | a NaN or infinite position or UV in a buffer, a world transform that overflows, or a placed position or transformed UV beyond the float32 range                                                                                                                                                                                                   |

## Warnings

At most 100 are kept (`MAX_GLTF_WARNINGS`); each has `code`, `path`, `message`. The codes are those of the table in
[Not supported](#not-supported-reported).

## Local-first

A model never causes a network request or a file read: a `uri` is only matched, by relative path and then by
case-insensitive base name, against the files the caller passed in `files`. `http:`, `https:`, `file:`, `//` and every
other URL is reported as not fetched. `@modelshot/formats` has no `fetch` call.

`listGltfReferences(input, { maxReferences })` lists what a caller may have to supply: the `uri` of every buffer and
image as written (`data:` URIs left out, each relative path once, at most `maxReferences + 1`, nothing for a file
`loadGltf` would refuse). The embed uses it to download a `.gltf`'s files from the model's own server before loading
([Embed](embed.md#models-with-several-files)); `normaliseReference`, `referenceBaseName` and `isUrlReference` are the
loader's own lookup rules, so a downloaded file named by `referenceBaseName(normaliseReference(uri))` is found.
