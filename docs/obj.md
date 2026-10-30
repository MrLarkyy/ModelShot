# OBJ loader

```ts
import { loadObj, ObjError } from '@modelshot/formats';

const { scene, warnings } = loadObj(fileBytesOrText, {
  fileName: 'crate.obj', // optional: for messages and the name of faces before any o/g
  files: new Map([
    ['crate.mtl', mtlBytes],
    ['crate.png', pngBytes],
  ]), // optional: files picked next to the model
  limits: { maxTriangles: 100_000 }, // optional: overrides of DEFAULT_OBJ_LIMITS
  unitScale: 16, // optional: scene units per OBJ unit (default DEFAULT_OBJ_UNIT_SCALE)
});
```

`loadObj(input: string | Uint8Array, options?)` loads a Wavefront `.obj` with its `.mtl` material libraries and PNG
textures into a [scene format v1](scene-format.md) document plus warnings. It is synchronous and bounded (one linear
scan over the text, limits checked as counts grow) and reads nothing but the files the caller passed. It throws only
`ObjError` (and a `RangeError` for invalid `options`).

## Supported

- `v` (x y z; a fourth `w` is ignored), `vt` (u [v]), `vn`; `f` with `v`, `v/vt`, `v//vn` or `v/vt/vn` corners,
  1-based or negative (relative) indices; polygons of 3 to `maxFaceVertices` (64) vertices, concave ones included.
- `o` and `g` (each starts an object), `usemtl`, `mtllib` (each distinct name read once; names resolving to the same
  picked file parse it once); `#` comments, blank lines, CRLF line ends, a byte-order
  mark, and lines continued with a trailing backslash. The text is decoded as UTF-8 with invalid bytes replaced.
- MTL: `newmtl`, `Kd` (r g b, or one grey value), `d`, `Tr` (when there is no `d`), `map_Kd` (PNG).

## Not supported (reported)

| feature                                                                                                               | result                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `l`, `p`, curves and surfaces (`curv`, `curv2`, `surf`, `cstype`, `deg`, `vp`, …), `lod`, `usemap`, any other keyword | warning `UNSUPPORTED_STATEMENT`, one per keyword with its count and first line, for the first 64 distinct keywords; one more counts the lines of all others |
| colour components after `v x y z`                                                                                     | warning `UNSUPPORTED_VERTEX_COLOR` once; positions load                                                                                                     |
| `s` smoothing groups in a file without `vn`                                                                           | warning `SMOOTHING_IGNORED` once; faces are flat                                                                                                            |
| a `mtllib` file not picked, or a URL                                                                                  | warning `MISSING_RESOURCE`; its materials' faces are drawn plain (−1)                                                                                       |
| a `usemtl` name no loaded library defines                                                                             | warning `UNKNOWN_MATERIAL`; drawn plain (−1)                                                                                                                |
| `map_Kd` options (`-o`, `-s`, `-t`, `-clamp`, `-bm`, `-mm`, …)                                                        | warning `UNSUPPORTED_MAP_OPTION`, one per material; the file is still read                                                                                  |
| other maps (`map_Ka`, `map_Ks`, `map_Bump`, `map_d`, `bump`, `norm`, `disp`, `decal`, `refl`, …)                      | warning `UNSUPPORTED_MATERIAL_FEATURE`, one per material listing them                                                                                       |
| `Ka`, `Ks`, `Ke`, `Ns`, `Ni`, `illum`, `Tf`, PBR parameters (`Pr`, `Pm`, …), `Kd spectral` / `Kd xyz`                 | warning `MATERIAL_PARAMS_IGNORED`, one per material listing them                                                                                            |
| `Kd` ≠ white or `d` < 1 beside `map_Kd`                                                                               | warning `BASE_COLOR_FACTOR_IGNORED`; the texture is drawn as it is                                                                                          |
| a `map_Kd` file not picked, a URL, or not a PNG                                                                       | warning `MISSING_RESOURCE` or `UNSUPPORTED_IMAGE`; the texture is `missing`                                                                                 |

## Conversion

- **Units and axes**: positions × `unitScale` (default 16: 1 OBJ unit = 1 block, the scale of Blockbench's OBJ export);
  OBJ's y-up right-handed axes are the scene's.
- **Objects**: every `o` / `g` starts an object; faces before any of them belong to an object named after the file.
  Each object with faces is one root `SceneNode` with one `SceneMesh`; empty objects are dropped.
- **Groups**: one `SceneMeshGroup` per material, in order of first `usemtl`, faces without a known material last;
  every group is `doubleSided` (OBJ has no sidedness, and exporters wind inconsistently).
- **Triangulation**: polygons are triangulated in their plane (ear clipping; a self-intersecting polygon falls back to
  a fan), counter-clockwise about the face's Newell normal; a face with zero area is dropped.
- **Vertices**: corners with a `vn` are shared per group by their `v/vt/vn` triple; a face without `vn` on every corner
  gets its own corners with its flat face normal. A zero `vn` takes the face normal.
- **UVs**: `vt` v is flipped (`1 − v`: OBJ's v grows upwards, the scene's downwards). Faces of a `map_Kd` material
  without `vt` sample texel (0, 0); `uvRects` are the union of the triangle UV boxes per vertex, as for glTF.
- **Materials**: `map_Kd` → that PNG, `blend` with `BLEND_ALPHA_CUTOFF` (only alpha byte 0 is invisible, as Blockbench
  and most OBJ viewers draw textures). Without `map_Kd`: a generated 1×1 PNG of `Kd` (read as sRGB, as three.js's
  MTLLoader does) with alpha `d`; `blend` when `d` < 1, else `opaque`.
- **Filter**: every texture is nearest (no `SceneTexture.filter`, MS-38): MTL has no filter statement, and its
  `-blendu` / `-blendv` options (on by default) would turn every OBJ smooth, against the pixel-art default; they stay
  `UNSUPPORTED_MAP_OPTION`.
- `source`: `{ format: 'obj', formatVersion: '', modelFormat: 'obj' }`.

## Limits

Override per call with `options.limits` (a positive integer or `Infinity`, else a `RangeError`).

| limit              | default    | error                                                                                                     |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| `maxFileBytes`     | 64 MiB     | `FILE_TOO_LARGE` (the `.obj`, and each `.mtl`), checked before decoding                                   |
| `maxLineChars`     | 4096       | `LINE_TOO_LONG` (a logical line, continuations joined), checked before splitting                          |
| `maxFaceVertices`  | 64         | `TOO_MANY_FACE_VERTICES`                                                                                  |
| `maxTriangles`     | 200 000    | `TOO_MANY_TRIANGLES` (n − 2 per face, counted while parsing)                                              |
| `maxVertices`      | 400 000    | `TOO_MANY_VERTICES` (`v`, `vt`, `vn` statements each, and built vertices)                                 |
| `maxObjects`       | 10 000     | `TOO_MANY_OBJECTS` (`o` and `g` statements)                                                               |
| `maxMaterials`     | 256        | `TOO_MANY_MATERIALS` (`usemtl` names, distinct `newmtl` names, distinct `mtllib` names)                   |
| `maxTextures`      | 64         | `TOO_MANY_TEXTURES` (`map_Kd` images; generated colour textures are bounded by the materials, as in glTF) |
| `maxTextureSide`   | 4096 px    | `TEXTURE_TOO_LARGE`                                                                                       |
| `maxTexturePixels` | 16 777 216 | `TEXTURE_TOO_LARGE`                                                                                       |
| `maxStringChars`   | 1024       | names and file references are cut to this length                                                          |

Ear clipping is O(n³) per face; at the defaults a file of 64-vertex concave faces up to the triangle limit loads in
well under a second on the dev machine (`bounded.test.ts`).

## Errors

`ObjError` has a `code`, a `path` `<file>:<line>` (`crate.obj:12`, `crate.mtl:3`; the file name alone for the whole
file) and a message quoting at most 32 characters of file content.

| code                 | when                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_TOO_LARGE`     | the `.obj` or a `.mtl` exceeds `maxFileBytes`                                                                                            |
| `LINE_TOO_LONG`      | a logical line exceeds `maxLineChars`                                                                                                    |
| `INVALID_STATEMENT`  | too few numbers for `v`, `vt` or `vn`; a face of fewer than 3 corners; a malformed corner or index; input that is neither text nor bytes |
| `INDEX_OUT_OF_RANGE` | index 0, or an index beyond the `v`, `vt` or `vn` statements read so far                                                                 |
| `NON_FINITE_DATA`    | a number that is not finite (`NaN`, `Infinity`, `1e999`), or not finite in float32 (a position times `unitScale`, a `vt` or `vn` value)  |
| `TOO_MANY_*`         | a count over its limit (see Limits)                                                                                                      |
| `TEXTURE_TOO_LARGE`  | a `map_Kd` PNG over the side or pixel limit                                                                                              |

## Warnings

At most 100 are kept (`MAX_OBJ_WARNINGS`); each has `code`, `path`, `message`. The codes are those of the table in
[Not supported](#not-supported-reported).

## Local-first

`mtllib` and `map_Kd` are only matched, by relative path and then by case-insensitive base name, against the files the
caller passed in `files`; a URL is reported as not fetched. Nothing else is read.

`listObjReferences(input, { maxReferences })` lists the `mtllib` names of an `.obj`, and `listMtlReferences` (the
same arguments) the `map_Kd` file of each material of an `.mtl` (its last one, options skipped, the first definition
of a name), as the loader reads them: in order, each relative path once, at most `maxReferences + 1`, nothing for a
file the loader would refuse. The embed uses them to download an `.obj`'s libraries and then their textures (relative
to each library) from the model's own server ([Embed](embed.md#models-with-several-files)).
