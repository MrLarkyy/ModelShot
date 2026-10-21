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

## Supported

- Format versions 3.x, 4.x and 5.x (`meta.format_version`); any project format (`free`, `bedrock`, `java_block`, …).
- **Cubes**: `from`/`to` (either order), `origin` (pivot), `rotation` (any angles), `inflate` (also negative),
  `stretch`, per-face `uv` with `rotation` (0, 90, 180, 270) and mirroring (u1 > u2 or v1 > v2), per-face `texture`
  (index or texture uuid), `visibility`, `render_order`.
- **Meshes** (`type: "mesh"`): `vertices` (key → position relative to `origin`), `faces` (key → `vertices` list,
  `uv` per vertex key, `texture`), `origin`, `rotation`, `visibility`, `render_order`, `shading` (`flat` or
  `smooth`). Triangles, quads and polygons
  of up to `maxFaceVertices` (16) vertices; faces with fewer than 3 vertices or no area are dropped.
- **Planes**: Blockbench has no plane element; a plane is a mesh quad (the plane primitive) or a cube flat on one
  axis. Both load as above.
- **Render sides** (texture `render_sides`: `auto`, `front`, `double`) set `SceneMeshGroup.doubleSided` of every face
  with that texture; untextured faces follow the format.
- **Per-texel alpha**: every material is `alphaMode: "blend"` with `alphaCutoff: 0.01`, as Blockbench draws textures
  (see the [scene format](scene-format.md#scenematerial) for what each pass does with a texel).
- **Box UV** (`meta.box_uv` or the cube's `box_uv`): faces without a `uv` get Blockbench's box layout from
  `uv_offset`, the cube size and `mirror_uv`. The size is `to − from` of the plain cube (inflate and stretch ignored),
  floored as `floor(to − from + 1e-7)`, except in `modded_entity` where Blockbench keeps fractional box-UV sizes. In a
  box-UV project (`meta.box_uv`) before format 4.5 a cube's `shade: false` means mirrored UV, as Blockbench reads it.
- **Groups / bones**: `name`, `origin` (pivot), `rotation`, `visibility`; inline in the outliner (format ≤ 4.x) or in the
  top-level `groups` array referenced by uuid from the outliner (format 5.x). Both give the same node tree. Files before
  format 3.2 stored the z rotation of groups with the opposite sign; it is negated on load, as Blockbench does.
- **Textures**: PNG only. Embedded `data:image/png;base64,…` sources are decoded; any other texture is matched by the
  case-insensitive base name of its `relative_path`, then `path`, then `name` against `options.textureFiles`.
  In the `free` format (Blockbench's only format with per-texture UV size) `uv_width`/`uv_height` set a texture's UV
  space; in every other format, and when absent, the project `resolution` (default 16×16) does. Bedrock's per-texture
  UV size exists only with a multi-file ruleset, which is Blockbench runtime state not saved in the file, so bedrock
  models use the project resolution.
- **Animations** (`animations`): every animation becomes a [`SceneAnimation`](scene-format.md#animations) with its
  `name`, `loop` (`once`, `hold`, `loop`) and `length`. Bone animators play their `rotation`, `position` and `scale`
  keyframes with `linear`, `catmullrom` and `step` interpolation, pre/post data points and numeric data points (a
  number, or a string holding a decimal literal such as `"-12.5"`; blank is 0). Animators are found by group uuid, or
  for a key that is no uuid by group name ignoring case, as Blockbench does. Files before 3.7 (`bones`, an animator
  that is a keyframe array, values on the keyframe itself) load too.

## Not yet supported

Skipped with an `UNSUPPORTED_ELEMENT` warning: `locator`, `null_object`, `texture_mesh`, `billboard`, `spline_mesh`,
armatures and any other element type except `cube` and `mesh`. An animated (strip) texture is
carried as one image. A texture `render_mode` (emissive,
additive, layered) is not carried.

Animation parts that are not played as authored, each reported (see Warnings) and the rest of the clip played:
Molang expressions (the keyframe is skipped; constants play), `bezier` keyframes (played linear), effect animators
(`sound`, `particle`, `timeline`), animators of other elements (null objects, cubes, meshes, …), unknown channels,
`rotation_global` (played in local space), `quaternion_interpolation` (played as Euler angles; reported only in the
`free` format, the one format where Blockbench honours the animator's flag, elsewhere it plays Euler angles too), `anim_time_update`,
`start_delay`, `loop_delay` and `blend_weight` (played at normal speed, without delay, at full weight), and negative
scale (played as the smallest positive scale).

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
  cube keeps only its large faces, single-sided when both are drawn (see sidedness below). Blockbench instead pads the cube by
  0.001 and draws all six faces with the texture's sidedness; there, with a double-sided texture, both large faces
  show from each side and fight in depth, and both cast shadows.
- Each mesh element becomes one `SceneMesh`: every face gets its own vertices, placed at
  `origin + v` and turned by `rotation` about `origin`, like a cube. UVs are the face `uv` over the texture's UV size
  (the project resolution for an untextured face); `uvRects` hold the bounding box of the face's UVs. Normals:
  `shading: "flat"` (the default; an unknown string warns and counts as flat) gives every vertex its face's normal;
  `smooth` gives every vertex the normal of its vertex key: the plain average of the unit normals of all faces (of 3
  or more vertices) listing the key, as Blockbench's `calculateNormals` computes it (unweighted by area or angle),
  normalised and then turned with the mesh.
- Mesh faces are triangulated in their plane: 3 vertices give one triangle; a quad is first put in Blockbench's
  vertex order (a quad stored out of order becomes a simple loop) and split along its 0–2 diagonal, or 1–3 when
  that one stays inside a concave quad; 5 to 16 vertices are ear-clipped, and a polygon that crosses itself falls
  back to a fan. Triangles wind counter-clockwise about the face normal (Newell's method over the vertex loop).
- Faces of a mesh are grouped by material, then single- before double-sided; cube faces likewise.
- Sidedness: a face is double-sided when its texture's `render_sides` is `double`, or `auto` in any format but
  `java_block`; untextured faces are double-sided except in `java_block`. A cube face lying in the plane of a
  zero-thickness axis (a flat cube) whose opposite face is drawn too is single-sided: the two are coincident and face
  opposite ways,
  so each side shows exactly one of them, and only the one whose front faces the light casts a shadow (single-sided
  means one-sided for every ray, see the [scene format](scene-format.md#scenemesh)). A lone face there (its opposite
  removed or absent, e.g. a glass pane) keeps its texture's sidedness, so it still shows from behind where the
  texture is double-sided, as in Blockbench.
- `render_order`: `default` (or absent) → `renderOrder` 0, `behind` → −1, `in_front` → 1.
- One material per texture, same index, `alphaMode: "blend"`, `alphaCutoff: 0.01`.
- Animations: keyframes of a format 5.0 file are taken in Blockbench's own convention, which is the scene's:
  Blockbench adds a keyframe's rotation (degrees) and position to the bone's three.js rotation and position, set from
  the group's `rotation` and `origin` as the loader reads them, and multiplies its scale. Files before format 5.0
  (including the pre-3.7 `bones` form) store rotation x, y and position x with the opposite sign: the loader negates
  them, pre and post data points alike, as Blockbench 5 does when it opens such a file; scale is unchanged.
  `position` becomes `translation`. Keyframes are sorted by time (stable). `length` is the file's `length` when it is
  above 0, even with keyframes past it (a trailing catmull-rom keyframe shapes the loop's tangent and does not change
  its period), else the time of the last keyframe. An animator without keyframes is skipped; a later animator for the
  same group replaces an earlier one. A file without `animations` (or with an empty list) gives a document without
  `animations`.

### Blockbench conventions assumed

These are pinned by tests (`packages/formats/test/bbmodel`) and were checked against Blockbench's source (rotation
order, face uv rotation, face `texture`, `stretch`, per-texture UV size, box-UV size and layout; for MS-12 the mesh
format, quad order and split, normal sign, `render_sides`, `render_order` and the alpha test).

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
6. **Mesh vertices** are in the mesh's local space: Blockbench places the mesh at `origin` with `rotation`, so a vertex
   lands at `origin + R · v`.
7. **Quad order** is `MeshFace.getSortedVertices`: if vertex 3 lies across the line 1–2 from vertex 0 the loop is
   2, 0, 1, 3; else if it lies across the line 0–1 from vertex 2 it is 0, 2, 1, 3; else the stored order. Blockbench
   draws (0, 1, 2) and (0, 2, 3) of that loop. The front is counter-clockwise: the normal is
   `(v1 − v0) × (v2 − v0)`; the plane primitive faces +Y.
8. **Mesh faces** with more than 4 vertices are not drawn by Blockbench, and none of its tools creates them (OBJ import
   keeps 4); ModelShot triangulates them. A mesh face with `texture: null` is drawn untextured (unlike a cube face).
   Blockbench defaults a missing uv entry to [0, 0]; every saved file has one per vertex, and ModelShot requires it.
9. **Render sides**: `Canvas.getRenderSide` with the default `render_sides` setting (`auto`): a texture's `front` or
   `double` wins, `auto` takes `Format.render_sides`, which only `java_block` sets (`front`), else double-sided.
10. **Alpha**: Blockbench draws textures blended and discards texels with alpha below 0.01 (`texture.frag.glsl`).
11. **Smooth shading** (`Mesh.calculateNormals`): per vertex key, the average of `MeshFace.getNormal(true)` (the unit
    `(s1 − s0) × (s2 − s0)` of the face's Blockbench vertex order) over the faces with more than 2 vertices that list
    the key; no area or angle weighting.
12. **Animations** (MS-21, checked against Blockbench `js/animations` at commit `ec0b282`): `BoneAnimator.interpolate`
    for the pair rules, pre/post data points and catmull-rom neighbours (including the wrap in `loop` mode),
    `displayRotation` / `displayPosition` / `displayScale` for the conventions above, `Animation.time` for the loop
    modes. ModelShot compares times exactly where Blockbench snaps within 1/1200 s, maps `loop` time with a plain
    modulo (Blockbench shows the end frame at exactly `length`), and returns a `once` clip to rest after its end
    (Blockbench's editor keeps the last frame; the game resets).
13. **Import migrations** (`js/formats/bbmodel.js` at commit `ec0b282`, the project codec's version gates): before 3.2
    every group's z rotation is negated; before 4.5 a box-UV project's cube with `shade: false` gets `mirror_uv`;
    before 5.0 every rotation keyframe's x and y and every position keyframe's x are negated. Blockbench's 5.0
    migration walks only `animators`, so it leaves pre-3.7 `bones` files unchanged; Blockbench 4 played those mirrored
    like every other 4.x file, and ModelShot negates them too, so they move as their author saw them.

## Limits

Checked before allocating or decoding; override per call with `options.limits`. An override must be a positive integer
or `Infinity`; anything else throws a `RangeError` (a caller error, not a `BbmodelError`).

| limit              | default    | error                                                               |
| ------------------ | ---------- | ------------------------------------------------------------------- |
| `maxFileBytes`     | 64 MiB     | `FILE_TOO_LARGE` (UTF-8 bytes of the file)                          |
| `maxElements`      | 10 000     | `TOO_MANY_ELEMENTS`                                                 |
| `maxGroups`        | 10 000     | `TOO_MANY_ELEMENTS` (also caps outliner entries: elements + groups) |
| `maxTriangles`     | 200 000    | `TOO_MANY_TRIANGLES` (counted before any geometry is built)         |
| `maxVertices`      | 400 000    | `TOO_MANY_VERTICES` (geometry vertices, and keys of one mesh)       |
| `maxFaceVertices`  | 16         | `TOO_MANY_VERTICES` (vertices of one mesh face)                     |
| `maxNesting`       | 64         | `NESTING_TOO_DEEP` (groups inside groups)                           |
| `maxTextures`      | 64         | `TOO_MANY_TEXTURES`                                                 |
| `maxTextureSide`   | 4096 px    | `TEXTURE_TOO_LARGE` (from the PNG header)                           |
| `maxTexturePixels` | 16 777 216 | `TEXTURE_TOO_LARGE`                                                 |
| `maxDataUriChars`  | 24 Mi      | `TEXTURE_TOO_LARGE` (length of a texture `source`)                  |
| `maxStringChars`   | 1024       | `INVALID_FIELD` (names, uuids, paths)                               |
| `maxAnimations`    | 1024       | `TOO_MANY_KEYFRAMES` (entries of `animations`)                      |
| `maxKeyframes`     | 200 000    | `TOO_MANY_KEYFRAMES` (all animations together, counted first)       |

Triangles are counted from an upper bound (k − 2 per mesh face of k vertices) and vertices per face (each face has
its own), both before any geometry is built; a mesh's `vertices` key count is checked before its lookup table is
built. Ear clipping is O(k³) for k ≤ 16, so `maxTriangles` faces load in well under 5 s.

Every animation, animator (at most `maxGroups + maxElements + 1` per animation) and keyframe is counted before any
keyframe is read. Only the first two data points of a keyframe are read.

Numbers must be finite and within ±10 000 000; keyframe values, keyframe times and animation lengths within ±10⁶
(`MAX_ANIMATION_VALUE`, what `animateScene` accepts), times not negative. The outliner is walked with an explicit stack, so nesting depth is
bounded by `maxNesting`, not by the call stack.

## Errors

`BbmodelError` has a `code`, a JSON `path` into the file (e.g. `$.elements[3].faces.north.uv[2]`) and a message
`<what> at <path>: <expected>`. A message quotes at most 32 characters of file content and shortens deep paths.

| code                  | when                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FILE_TOO_LARGE`      | the file exceeds `maxFileBytes`                                                                                                                                                                                                                                                                             |
| `NOT_JSON`            | empty, not UTF-8, or not JSON                                                                                                                                                                                                                                                                               |
| `NOT_BBMODEL`         | not an object, or no `meta` / `meta.format_version`                                                                                                                                                                                                                                                         |
| `UNSUPPORTED_VERSION` | format version not 3.x–5.x                                                                                                                                                                                                                                                                                  |
| `INVALID_FIELD`       | a field has the wrong type, a non-finite number, a face rotation that is not a quarter turn, a texture index out of range or an unknown texture uuid; a mesh face naming a vertex key the mesh lacks or the same key twice, or missing a uv entry; a non-string `render_order`, `render_sides` or `shading` |
| `TOO_MANY_ELEMENTS`   | elements, groups or outliner entries over their limit                                                                                                                                                                                                                                                       |
| `TOO_MANY_TRIANGLES`  | triangles over `maxTriangles`                                                                                                                                                                                                                                                                               |
| `TOO_MANY_VERTICES`   | vertices over `maxVertices`, or a mesh face over `maxFaceVertices`                                                                                                                                                                                                                                          |
| `TOO_MANY_TEXTURES`   | textures over `maxTextures`                                                                                                                                                                                                                                                                                 |
| `TOO_MANY_KEYFRAMES`  | animations, animators of one animation, or keyframes over their limit; the message names which                                                                                                                                                                                                              |
| `NESTING_TOO_DEEP`    | groups nested deeper than `maxNesting`                                                                                                                                                                                                                                                                      |
| `DUPLICATE_REFERENCE` | the same uuid twice: two elements, two `groups` entries, or one element or group placed twice in the outliner (this also rejects a group inside itself)                                                                                                                                                     |
| `TEXTURE_TOO_LARGE`   | data URI longer than `maxDataUriChars`, or the PNG exceeds the side or pixel limit                                                                                                                                                                                                                          |
| `BAD_TEXTURE`         | a data URI that is not base64 PNG, bad base64, or bytes that are not a PNG (no IHDR, zero size)                                                                                                                                                                                                             |

## Warnings

The model still loads; at most 100 warnings are kept (`MAX_BBMODEL_WARNINGS`). Each has `code`, `path`, `message`.

| code                  | when                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `UNSUPPORTED_ELEMENT` | an element type other than `cube` or `mesh`; skipped                                                   |
| `UNSUPPORTED_VALUE`   | an unknown `render_order`, `render_sides` or `shading` string; the default is used                     |
| `UNKNOWN_REFERENCE`   | an outliner entry names a uuid no element has; skipped                                                 |
| `SOURCE_NOT_FETCHED`  | a texture `source` that is not a data URI (a URL or file path); never fetched                          |
| `MISSING_TEXTURE`     | no embedded image and no matching picked file; the texture is `missing`                                |
| `UNSUPPORTED_CHANNEL` | an animation part not played as authored (Not yet supported); once per animation, animator and channel |

Animations also warn `UNSUPPORTED_VALUE` for an unknown `loop` (played `once`) or interpolation (played linear),
`anim_time_update`, `start_delay`, `loop_delay`, `blend_weight` other than their defaults and negative scale, and
`UNKNOWN_REFERENCE` for an animator whose uuid or name matches no group.

## Compatibility

MS-12 adds the error code `TOO_MANY_VERTICES`, the warning code `UNSUPPORTED_VALUE` and the limits `maxVertices` and
`maxFaceVertices`. At runtime this is additive; TypeScript code with an exhaustive `switch` over
`BbmodelErrorCode` or `BbmodelWarningCode` gets a compile error until it handles the new codes.

MS-21 adds animations: the error code `TOO_MANY_KEYFRAMES`, the warning code `UNSUPPORTED_CHANNEL`, the limits
`maxAnimations` and `maxKeyframes`, and `SceneDocument.animations` on files that have any. Files without animations
load exactly as before; files with animations that are malformed (a wrong JSON type, a negative time, a value beyond
±10⁶) now fail with `INVALID_FIELD` where they used to load with the animations ignored. Exhaustive switches over the
code unions get a compile error, as above.

MS-21 also applies Blockbench's import migrations (Blockbench conventions 13), which changes how some old files load:
a file before format 3.2 now has its groups' z rotation negated (it used to load turned the wrong way about z), and a
box-UV cube with `shade: false` in a file before 4.5 now has mirrored UV. Keyframes of files before 5.0 are negated
in rotation x, y and position x; no earlier release read animations, so nothing that loaded before changes there.

## Local-first

A model never causes a network request or a file read: texture URLs and paths in the file are only used as names to
match against the files the caller passed in `textureFiles`.
