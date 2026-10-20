# Blockbench `.bbmodel` loader

```ts
import { loadBbmodel, BbmodelError } from '@modelshot/formats';

const { scene, warnings } = loadBbmodel(fileBytesOrText, {
  textureFiles: new Map([['skin.png', pngBytes]]), // optional: files the user picked next to the model
  limits: { maxTriangles: 100_000 }, // optional: overrides of DEFAULT_BBMODEL_LIMITS
});
```

`loadBbmodel(input: string | Uint8Array, options?)` returns a [scene format v1](scene-format.md) document and a list of
warnings. It is synchronous and bounded: every count, size and depth is checked against a limit before anything
proportional to it is allocated or decoded, so a hostile file fails fast instead of hanging the tab. It throws only
`BbmodelError`.

## Supported (v0)

- Format versions 3.x, 4.x and 5.x (`meta.format_version`); any project format (`free`, `bedrock`, `java_block`, …).
- **Cubes**: `from`/`to` (either order), `origin` (pivot), `rotation` (any angles), `inflate` (also negative),
  `stretch`, per-face `uv` with `rotation` (0, 90, 180, 270) and mirroring (u1 > u2 or v1 > v2), per-face `texture`
  (index or texture uuid), `visibility`.
- **Box UV** (`meta.box_uv` or the cube's `box_uv`): faces without a `uv` get Blockbench's box layout from
  `uv_offset`, the cube size and `mirror_uv`. The size is `to − from` of the plain cube (inflate and stretch ignored),
  floored as `floor(to − from + 1e-7)`, except in `modded_entity` where Blockbench keeps fractional box-UV sizes.
- **Groups / bones**: `name`, `origin` (pivot), `rotation`, `visibility`; inline in the outliner (format ≤ 4.x) or in the
  top-level `groups` array referenced by uuid from the outliner (format 5.x). Both give the same node tree.
- **Textures**: PNG only. Embedded `data:image/png;base64,…` sources are decoded; any other texture is matched by the
  case-insensitive base name of its `relative_path`, then `path`, then `name` against `options.textureFiles`.
  In the `free` format (Blockbench's only format with per-texture UV size) `uv_width`/`uv_height` set a texture's UV
  space; in every other format, and when absent, the project `resolution` (default 16×16) does. Bedrock's per-texture
  UV size exists only with a multi-file ruleset, which is Blockbench runtime state not saved in the file, so bedrock
  models use the project resolution.

## Not yet supported

Skipped with an `UNSUPPORTED_ELEMENT` warning: `mesh`, `locator`, `null_object`, `texture_mesh` and any other element
type except `cube` (meshes and planes are MS-12). Animations are ignored. An animated (strip) texture is carried as one
image.

## Conversion

- Each cube becomes one `SceneMesh` with 4 vertices and 2 triangles per face, its own rotation about `origin` baked into
  the vertices. Its `node` is the group it sits in, or −1 at the root.
- Group nodes keep `pivot` and `rotation`; meshes are placed by the node's world matrix (see the scene format).
- Order: nodes and meshes follow the outliner (depth first); elements the outliner does not reference follow at the
  root in file order. An outliner entry for an unknown uuid is skipped with an `UNKNOWN_REFERENCE` warning.
- Cube box: per axis `centre ∓ (half + inflate) · stretch`, as Blockbench. A negative inflate larger than half a side
  collapses that axis to its centre. A negative stretch counts as its magnitude: Blockbench swaps that axis (the east
  face and its texture end up mirrored on the −X side); ModelShot does not mirror the cube that way. Stretch and
  inflate change geometry only, never UVs.
- Faces: `texture: null` removes the face (no triangles, its other fields are not read, it does not count towards
  `maxTriangles`); no `texture` key or `texture: false` is a blank face drawn untextured (material −1, UVs normalised
  by the project resolution); a number is a texture index and a string a texture uuid (unknown → `INVALID_FIELD`).
  A face object missing from `faces` produces no triangles. A face with zero area produces no triangles, so a flat
  cube keeps only its two large faces (Blockbench pads it by 0.001 and draws all six, which looks the same).
- One material per texture, same index.

### Blockbench conventions assumed

These are pinned by tests (`packages/formats/test/bbmodel`) and were checked against Blockbench's source (rotation
order, face uv rotation, face `texture`, `stretch`, per-texture UV size, box-UV size and layout).

1. **Rotation order and sign**: degrees, three.js Euler order `'ZYX'` (X applied first), right-handed: +90° about Y
   takes +X to −Z. Cube and group rotations use the same convention.
2. **Face corners**: a face `uv [u1, v1, u2, v2]` maps (u1, v1) to the face's top-left corner seen from outside. Side
   faces have +Y at the top; north's top-left is east (+X), south's is west, east's is south (+Z), west's is north. The
   up face has north at the top (top-left = north-west); the down face has south at the top (top-left = south-west).
   This is Minecraft's automatic UV layout. Face `rotation` turns the image **clockwise** on the face.
3. **Format 5.x groups**: group data (name, origin, rotation, visibility) lives in `groups`, the outliner holds
   `{ uuid, children }`; an outliner object whose uuid is not in `groups` is read as an inline group.
4. **Face `texture`**: in a saved file `null` is a removed face (Blockbench does not draw it); an absent key is a blank
   face (in memory `false`) drawn without texture; an integer is a texture index, a string a texture uuid from older
   saves.
5. **Box UV layout** (w, h, d = box-UV size x, y, z): east at (0, d) d×h, north at (d, d) w×h, west at (d + w, d)
   d×h, south at (2d + w, d) w×h, up in (d, 0)–(d + w, d) stored turned 180° (`[d + w, d, d, 0]`), down in
   (d + w, 0)–(d + 2w, d) stored mirrored horizontally (`[d + 2w, 0, d + w, d]`), all shifted by `uv_offset`;
   `mirror_uv` flips every face horizontally and swaps east and west.

## Limits

Checked before allocating or decoding; override per call with `options.limits`. An override must be a positive integer
or `Infinity`; anything else throws a `RangeError` (a caller error, not a `BbmodelError`).

| limit              | default    | error                                                               |
| ------------------ | ---------- | ------------------------------------------------------------------- |
| `maxFileBytes`     | 64 MiB     | `FILE_TOO_LARGE` (UTF-8 bytes of the file)                          |
| `maxElements`      | 10 000     | `TOO_MANY_ELEMENTS`                                                 |
| `maxGroups`        | 10 000     | `TOO_MANY_ELEMENTS` (also caps outliner entries: elements + groups) |
| `maxTriangles`     | 200 000    | `TOO_MANY_TRIANGLES` (counted before any geometry is built)         |
| `maxNesting`       | 64         | `NESTING_TOO_DEEP` (groups inside groups)                           |
| `maxTextures`      | 64         | `TOO_MANY_TEXTURES`                                                 |
| `maxTextureSide`   | 4096 px    | `TEXTURE_TOO_LARGE` (from the PNG header)                           |
| `maxTexturePixels` | 16 777 216 | `TEXTURE_TOO_LARGE`                                                 |
| `maxDataUriChars`  | 24 Mi      | `TEXTURE_TOO_LARGE` (length of a texture `source`)                  |
| `maxStringChars`   | 1024       | `INVALID_FIELD` (names, uuids, paths)                               |

Numbers must be finite and within ±10 000 000. The outliner is walked with an explicit stack, so nesting depth is
bounded by `maxNesting`, not by the call stack.

## Errors

`BbmodelError` has a `code`, a JSON `path` into the file (e.g. `$.elements[3].faces.north.uv[2]`) and a message
`<what> at <path>: <expected>`. A message quotes at most 32 characters of file content and shortens deep paths.

| code                  | when                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_TOO_LARGE`      | the file exceeds `maxFileBytes`                                                                                                                         |
| `NOT_JSON`            | empty, not UTF-8, or not JSON                                                                                                                           |
| `NOT_BBMODEL`         | not an object, or no `meta` / `meta.format_version`                                                                                                     |
| `UNSUPPORTED_VERSION` | format version not 3.x–5.x                                                                                                                              |
| `INVALID_FIELD`       | a field has the wrong type, a non-finite number, a face rotation that is not a quarter turn, a texture index out of range or an unknown texture uuid    |
| `TOO_MANY_ELEMENTS`   | elements, groups or outliner entries over their limit                                                                                                   |
| `TOO_MANY_TRIANGLES`  | triangles over `maxTriangles`                                                                                                                           |
| `TOO_MANY_TEXTURES`   | textures over `maxTextures`                                                                                                                             |
| `NESTING_TOO_DEEP`    | groups nested deeper than `maxNesting`                                                                                                                  |
| `DUPLICATE_REFERENCE` | the same uuid twice: two elements, two `groups` entries, or one element or group placed twice in the outliner (this also rejects a group inside itself) |
| `TEXTURE_TOO_LARGE`   | data URI longer than `maxDataUriChars`, or the PNG exceeds the side or pixel limit                                                                      |
| `BAD_TEXTURE`         | a data URI that is not base64 PNG, bad base64, or bytes that are not a PNG (no IHDR, zero size)                                                         |

## Warnings

The model still loads; at most 100 warnings are kept (`MAX_BBMODEL_WARNINGS`). Each has `code`, `path`, `message`.

| code                  | when                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `UNSUPPORTED_ELEMENT` | an element type other than `cube`; skipped                                    |
| `UNKNOWN_REFERENCE`   | an outliner entry names a uuid no element has; skipped                        |
| `SOURCE_NOT_FETCHED`  | a texture `source` that is not a data URI (a URL or file path); never fetched |
| `MISSING_TEXTURE`     | no embedded image and no matching picked file; the texture is `missing`       |

## Local-first

A model never causes a network request or a file read: texture URLs and paths in the file are only used as names to
match against the files the caller passed in `textureFiles`.
