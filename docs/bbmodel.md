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

- Format versions 3.x, 4.x and 5.x (`meta.format_version`); any project format (`free`, `bedrock`, `java_block`, …). A file whose `meta.model_format` is absent, empty, `null`, `false` or `0` is read as Blockbench does: `java_block`, or `bedrock_old` when `meta.bone_rig` is truthy; its scene `source.modelFormat` stays `unknown`.
- **Cubes**: `from`/`to` (from > to on an axis reverses it, see Conversion), `origin` (pivot), `rotation` (any angles), `inflate` (also negative),
  `stretch`, per-face `uv` with `rotation` (0, 90, 180, 270) and mirroring (u1 > u2 or v1 > v2), per-face `texture`
  (index or texture uuid), `visibility`, `render_order`.
- **Meshes** (`type: "mesh"`): `vertices` (key → position relative to `origin`), `faces` (key → `vertices` list,
  `uv` per vertex key, `texture`), `origin`, `rotation`, `visibility`, `render_order`, `shading` (`flat` or
  `smooth`). Triangles, quads and polygons
  of up to `maxFaceVertices` (16) vertices; faces with fewer than 3 vertices or no area are dropped.
- **Planes**: Blockbench has no plane element; a plane is a mesh quad (the plane primitive) or a cube flat on one
  axis. Both load as above.
- **Render sides** (texture `render_sides`: `auto`, `front`, `double`) set `SceneMeshGroup.doubleSided` of every face
  with that texture; untextured faces follow the format, except on an inverted cube (Conversion, cube box).
- **Per-texel alpha**: every texture material is `alphaMode: "blend"` with `alphaCutoff: 0.01`, as Blockbench draws
  textures (see the [scene format](scene-format.md#scenematerial) for what each pass does with a texel), except an
  `emissive` texture's (`mask`, 0.01); a layer composite is `blend` with `alphaCutoff: 0.05` (below).
- **Render modes** (MS-29, texture `render_mode`: `default`, `emissive`, `additive`, `layered`) map to the
  optional [`SceneMaterial`](scene-format.md#scenematerial) fields `alphaMode`, `blending`, `alphaEmission` and
  `layers` (Conversion); an unknown value warns and loads as `default`. In the single-texture formats a face shows
  the format's default texture, as Blockbench draws it (Conversion, Blockbench conventions 15).
- **Box UV** (`meta.box_uv` or the cube's `box_uv`): faces without a `uv` get Blockbench's box layout from
  `uv_offset`, the cube size and `mirror_uv`. The size is `to − from` of the plain cube (signed, so negative on a
  reversed axis, as Blockbench lays it out; inflate and stretch ignored),
  floored as `floor(to − from + 1e-7)`, except in `modded_entity` and the Hytale plugin formats `hytale_character` and
  `hytale_prop`, where Blockbench keeps fractional box-UV sizes (`Format.box_uv_float_size`). In a
  box-UV project (`meta.box_uv`) before format 4.5 a cube's `shade: false` means mirrored UV, as Blockbench reads it.
- **Groups / bones**: `name`, `origin` (pivot), `rotation`, `visibility`; inline in the outliner (format ≤ 4.x) or in the
  top-level `groups` array referenced by uuid from the outliner (format 5.x). Both give the same node tree. Files before
  format 3.2 stored the z rotation of groups with the opposite sign; it is negated on load, as Blockbench does.
- **Textures**: PNG only. Embedded `data:image/png;base64,…` sources are decoded; any other texture is matched by the
  case-insensitive base name of its `relative_path`, then `path`, then `name` against `options.textureFiles`.
  In the formats with per-texture UV size (Blockbench `Format.per_texture_uv_size`: `free`, `image`,
  `optifine_entity`, `optifine_part`, and the plugin formats `figura`, `hytale_character` and `hytale_prop`)
  `uv_width`/`uv_height` set a texture's UV space; in every other format, and when absent, the project `resolution`
  (default 16×16) does. A bad value fails a `free` file (`INVALID_FIELD`) and warns in the others (read since MS-29,
  the plugin formats since MS-51; the resolution is used). Bedrock's per-texture UV size exists only with a
  multi-file ruleset, which is Blockbench runtime state not saved in the file, so bedrock models use the project
  resolution.
- **Frame-strip (animated) textures** (MS-27): in the formats where Blockbench animates textures (`free`,
  `java_block`, `bedrock`, `bedrock_block`, `bedrock_old`, `image`, and the plugin formats `geckolib_model` (GeckoLib),
  `animated_entity_model` (Animation Utils, legacy GeckoLib), `azure_model` (AzureLib), `bamo_model` (BAMO),
  `free_rotation`, `java_block_sequence` (Java Block Sequencer) and `cosmic_reach_entity_model` (Cosmic Reach Model
  Editor)) an image whose aspect ratio differs from its UV space's is
  a vertical strip of frames, counted as Blockbench does (Blockbench conventions 14). Faces on it show frame 0, as the
  Blockbench still preview does, and the texture carries [`SceneTexture.frames`](scene-format.md#scenetexture): the
  count, the frame time in seconds (`java_block`, `geckolib_model`, `free_rotation`, `java_block_sequence`: `frame_time` ticks; the others: `fps`), the play order from
  `frame_order_type` (`loop`, `backwards`, `back_and_forth`, `custom` with `frame_order`) and `frame_interpolate`. In
  any other format the strip is one image and the fields are ignored: `modded_entity`, `optifine_entity`,
  `optifine_part`, `skin`, `eme_entity`, `figura`, the Hytale and Cosmic Reach model formats, and a plugin format whose
  plugin ModelShot does not know (Blockbench opens that as `free` only with the plugin missing; here it stays a still). Nothing plays the frames yet.
- **Animations** (`animations`): every animation becomes a [`SceneAnimation`](scene-format.md#animations) with its
  `name`, `loop` (`once`, `hold`, `loop`) and `length`. Bone animators play their `rotation`, `position` and `scale`
  keyframes with `linear`, `catmullrom` and `step` interpolation, pre/post data points and numeric data points (a
  number, or a string holding a decimal literal such as `"-12.5"`; blank is 0). Animators are found by group uuid, or
  for a key that is no uuid by group name ignoring case, as Blockbench does. Files before 3.7 (`bones`, an animator
  that is a keyframe array, values on the keyframe itself) load too.

## Not yet supported

Skipped with an `UNSUPPORTED_ELEMENT` warning: `locator`, `null_object`, `texture_mesh`, `billboard`, `spline_mesh`,
armatures and any other element type except `cube` and `mesh`. Render modes load into material fields (Supported)
that no renderer draws yet (MS-32): emissive textures draw plainly lit, additive ones blended normally and a layer
composite as its bottom texture. A texture's `pbr_channel`, `wrap_mode` and per-layer paint data (`layers`) are not
read. Frame-strip textures load with their frame data (Supported) but no renderer or app plays them yet, and
the per-frame times of a `custom` `frame_order` (`2:5`) are ignored, as in Blockbench's preview; a picked image's
`.mcmeta` file is not read.

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
- Cube box: per axis the signed extent e = ((to − from) / 2 + inflate) · stretch about the centre (from + to) / 2,
  the box running from centre − e to centre + e, as Blockbench (`adjustFromAndToForInflateAndStretch`, `setShape`).
  An axis with e < 0 is reversed: from > to, a negative stretch, or a negative inflate larger than half a side (a
  positive inflate shrinks a reversed axis and, past zero, turns it back; e = 0 is a flat axis, not reversed). On a
  reversed axis every face is mirrored about the box centre and keeps its uv, so the east face of a cube reversed in
  x lies on the −X side. An odd number of reversed axes turns every face inward: an inverted hull, which shows only
  from inside or as a rim around what it encloses (the outline technique). Its faces whose texture has `render_sides`
  `auto`, and its untextured faces, draw single-sided in every format; `double` stays double-sided. This deviates on
  purpose from Blockbench, which sides `auto` by its Render Sides setting: with the default setting it draws them
  double-sided outside `java_block`, so the hull's outer side covers what it encloses; with the setting on Outside it
  draws the rim, as ModelShot does. An even number leaves an
  outward box, each face's texture on the opposite side turned 180°. The normal is each face's geometric front;
  Blockbench keeps the fixed normal of the face's key, which disagrees with the winding where exactly one other axis
  is reversed, so ModelShot lights those faces as their winding says. The 0.001 Blockbench adds to a flat axis is not
  applied (faces below). Stretch and inflate change geometry only, never UVs.
- Faces: `texture: null` removes the face (no triangles, its other fields are not read, it does not count towards
  `maxTriangles`); no `texture` key or `texture: false` is a blank face drawn untextured (material −1, UVs normalised
  by the project resolution) unless the format's default texture applies (below); a number is a texture index and a
  string a texture uuid (unknown → `INVALID_FIELD`).
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
- Frame strips: on a texture of n frames (Supported) v and the v entries of `uvRects` are divided by n after
  normalising, for cube and mesh faces alike (Blockbench's `updateUV` order), so frame 0 spans v in [0, 1/n] of the
  whole image and frame k is the same UV plus k/n. `width`/`height` stay the full image; untextured faces and faces on
  other textures are unchanged.
- Sidedness: a face is double-sided when its texture's `render_sides` is `double`, or `auto` in any format but
  `java_block`; untextured faces are double-sided except in `java_block`. A cube face lying in the plane of a
  zero-thickness axis (a flat cube) whose opposite face is drawn too is single-sided: the two are coincident and face
  opposite ways,
  so each side shows exactly one of them, and only the one whose front faces the light casts a shadow (single-sided
  means one-sided for every ray, see the [scene format](scene-format.md#scenemesh)). A lone face there (its opposite
  removed or absent, e.g. a glass pane) keeps its texture's sidedness, so it still shows from behind where the
  texture is double-sided, as in Blockbench.
- `render_order`: `default` (or absent) → `renderOrder` 0, `behind` → −1, `in_front` → 1.
- One material per texture, same index, by its `render_mode`; keys are present only when set, so a file without
  render modes gives the same materials as before:

  | `render_mode`                                 | material                                                          |
  | --------------------------------------------- | ----------------------------------------------------------------- |
  | `default` or absent                           | `alphaMode: "blend"`, `alphaCutoff: 0.01`                         |
  | `emissive`                                    | `alphaMode: "mask"`, `alphaCutoff: 0.01`, `alphaEmission: true`   |
  | `additive`                                    | `alphaMode: "blend"`, `alphaCutoff: 0.01`, `blending: "additive"` |
  | `layered`                                     | as `default` (its own material); see the layer composite below    |
  | anything else (unknown string, number, null…) | as `default`, `UNSUPPORTED_VALUE` at `$.textures[i].render_mode`  |

- Layer composite: in a single-texture format (`bedrock`, `bedrock_old`, `modded_entity`, `skin`, `image`,
  `bedrock_block`, `optifine_entity`, `optifine_part`, and the plugin formats `geckolib_model`,
  `animated_entity_model`, `azure_model`, `cosmic_reach_entity_model`, `optifine_player_model`, `hytale_character` and
  `hytale_prop`, the Hytale ones with or without `collections`, collection textures included) with two or more
  textures, one of them `layered` and at least one `visible`, one more material follows the texture materials: `name: "layered"`, `alphaMode: "blend"`,
  `alphaCutoff: 0.05`, `layers` the last three visible textures in file order, bottom first (a missing texture keeps
  its slot), and `texture` the bottom layer. Every face the loader draws uses it, sided as the format's default (the
  textures' `render_sides` and their own render modes do not apply); a cube face with `texture: null` stays removed.
  In any other format `layered` is `default`.
- Default texture (Blockbench conventions 15): in `bedrock`, `bedrock_old`, `modded_entity`, `skin`, `image`, the
  plugin formats `geckolib_model`, `animated_entity_model`, `azure_model`, `cosmic_reach_entity_model` and
  `optifine_player_model`, and the Hytale formats `hytale_character` and `hytale_prop` when the file has no non-empty
  `collections` array, every face (except `texture: null`) shows the default texture, whatever it stores; in
  `bedrock_block` blank faces do. In the Hytale formats with a non-empty `collections` array a cube that a collection
  contains (the cube's uuid or an ancestor group's uuid in its `children`, or an equal non-zero `scope` on both; the
  first such collection in file order) shows that collection's `texture` (a texture uuid) on every face except
  `texture: null`, untextured when it has none or names no texture (`UNKNOWN_REFERENCE`); any other cube shows the
  default texture on those faces, and mesh faces follow `bedrock_block`'s rule (blank faces show the default texture);
  in `optifine_entity` and `optifine_part` every face shows its parent group's `texture` (a texture uuid; one naming no
  texture warns `UNKNOWN_REFERENCE` and leaves the faces untextured, as Blockbench draws them) or else the default
  texture. The default texture is the first with `use_as_default` (`bedrock_block`, `optifine_entity`,
  `optifine_part`, `hytale_character`, `hytale_prop`; ignored elsewhere),
  else the last `visible` texture when there are two or more and one is `layered`, else the first; none leaves the
  face untextured. UV size, frame division and sidedness follow the texture shown. A mesh face with `texture: null`
  draws with the default texture's material in the formats above where every face shows it (Hytale only without
  `collections`; Blockbench gives the whole mesh that
  material), its UVs still over the project resolution without frame division, and with its group's texture in the
  `optifine` formats; elsewhere it stays untextured. `free`, `java_block`, `figura`, the plugin formats `bamo_model`,
  `free_rotation`, `java_block_sequence`, `cosmic_reach_model` and `eme_entity`, and unknown formats keep each face's
  own texture.
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
   face (in memory `false`) drawn without texture, except where the format's default texture applies (15); an
   integer is a texture index, a string a texture uuid from older saves.
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
   keeps 4); ModelShot triangulates them. A mesh face with `texture: null` is drawn (unlike a cube face), untextured
   except where the format's texture rules give it one (15).
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
14. **Frame strips** (MS-27, checked against the Blockbench 5 desktop bundle): `Texture.frameCount` exists only when
    `Format.animated_textures` (`free`, `java_block`, `bedrock`, `bedrock_block`, `bedrock_old`, `image`, and the plugin
    formats `geckolib_model`, `animated_entity_model`, `azure_model`, `bamo_model`, `free_rotation`,
    `java_block_sequence`, `cosmic_reach_entity_model`) and the image ratio
    `width / height` differs (`!==`) from `uvWidth / uvHeight`; it is `ceil(uvWidth / uvHeight / ratio − 0.05)` when
    above 1, so a strip slightly taller than whole frames rounds down and frames may be fractional pixels tall. The cube
    `updateUV` sets v to `(v / uvHeight) / frameCount` (+ frame / frameCount when playing), and the mesh `updateUV`
    `(v / uvHeight + frame) / frameCount`: both show frame 0 at rest. `TextureAnimator.playAnimationFrame`: with
    `Format.texture_mcmeta` (`java_block`, `geckolib_model`, `free_rotation`, `java_block_sequence`) a frame lasts `max(16.66, 50 · frame_time)` ms, else `1 / max(1, fps)` s
    (`fps` default 7, `frame_time` default 1); the order is `backwards` n − 1 − i, `back_and_forth` i for i < n then
    2n − 2 − i over 2n − 2 frames; `custom` (when `frame_order` is not empty) splits `frame_order` on whitespace and
    reads each token through `parseInt`, so a timed `index:time` token as Blockbench's `.mcmeta` import writes it plays
    its index. At counter step a it takes token a mod t (t tokens): a number k plays k mod n, a token that is no number
    plays a mod n. ModelShot stores that as an explicit list: the tokens mod n, or, with tokens that are no number, the
    whole period of lcm(t, n) steps (`"0 x"` on 4 frames plays 0, 1, 0, 3); a list equal to plain looping (a blank
    order, only words) is left out as `loop`. A negative or infinite token leaves Blockbench's frame negative or NaN,
    which its cube preview draws as frame 0; ModelShot plays 0 there. Blockbench reads a numeric string in
    `frame_time` or `fps` as a number; ModelShot warns and uses the default.
15. **Render modes and default texture** (MS-29, checked against the Blockbench 5 desktop bundle): the texture shader
    discards texels with alpha below 0.01 in every mode. `emissive` (`EMISSIVE` branch) then forces the output alpha to
    1 and lights each channel by `L + (1 − L)(1 − a)`, so a texel of colour c shows `c · a · L + c · (1 − a)`: alpha is
    an inverted emission mask (Bedrock's `entity_emissive_alpha`), an opaque texel is plainly lit. `additive` is lit
    like `default` with `AdditiveBlending`; Blockbench writes its depth, ModelShot keeps it order-independent and
    non-occluding. `layered`: the cube and mesh controllers give every element one `Canvas.getLayeredMaterial` when
    `Format.single_texture` or `Format.single_texture_default` holds, there are two or more textures and one is
    `layered`; it composites up to three visible textures from the end of the list (last on top) with the over
    operator, lit, discarding composite alpha below 0.05, sided by `Canvas.getRenderSide()`. Elsewhere
    `Texture.getMaterial` returns the texture's own material, so `layered` draws as `default`; under
    `Format.single_texture` alone the mesh controller gives the whole mesh `Texture.getDefault()`'s material, `null`
    faces included, while `updateUV` sizes those by `getTexture()` (null: project resolution). `Face.getTexture`:
    a parent group's `texture` under `Format.per_group_texture` (a uuid naming no texture finds nothing: the face is
    untextured); else, unless the face is `null`, `Texture.getDefault()`
    under `single_texture`, or under `single_texture_default` with per-group textures or on a blank face; else the
    stored texture. `Texture.getDefault`: a `use_as_default` texture under `single_texture_default`, else the selected
    texture (runtime state, never saved: ModelShot treats it as unset, as in a freshly opened project), else the last
    visible texture when there are two or more and one is `layered`, else the first. Plugin formats (MS-51, checked
    against blockbench-plugins and Blockbench master of 2026-10-22): GeckoLib's `geckolib_model` and its legacy
    `animated_entity_model` (geckolib.js:7405-7421, animation_utils.js:7096-7108), AzureLib's `azure_model`
    (azurelib_utils.js), Cosmic Reach's `cosmic_reach_entity_model` (cosmic_reach_model_editor.js:583-605) and
    OptiFine player models' `optifine_player_model` (optifine_player_models.js:562-572) set `single_texture`;
    Figura's `figura` (figura_format.js:59-73) sets `per_texture_uv_size`; the Hytale formats `hytale_character` and
    `hytale_prop` (hytale_plugin.js:795-887) set `single_texture_default`, `per_texture_uv_size` and
    `box_uv_float_size`, and define `single_texture` as a getter that holds while `Collection.all` is empty
    (:885-887). Blockbench fills `Collection.all` with one collection per entry of a `collections` array in the file,
    in file order, and ignores any other value (bbmodel.js:520-525; it saves the array only when non-empty, each entry
    as `uuid`, `name`, `children`, `scope`, export settings and, in Hytale formats, `texture`, collections.ts:246-253,
    :489-535). Its constructor reads `uuid` from the entry, so a `null` entry throws and Blockbench cannot open the
    file; any other entry that is no object (number, string, array) becomes an empty collection, which still turns
    `single_texture` off. ModelShot ignores a non-array without a warning and counts every entry that is no object,
    `null` included, as an empty collection with an `UNSUPPORTED_VALUE` warning. The Hytale plugin also replaces
    `CubeFace.getTexture` (hytale_plugin.js:1283-1302): a `null` face has none; else the first collection that
    `contains` the cube (`Collection.contains`, collections.ts:182-195: its `scope` is non-zero and equals the cube's
    saved `scope` (both read by `Merge.number`, util.js:401-413, so a numeric string such as `"2"` counts as 2), or
    `children` lists the cube's uuid or an ancestor group's uuid) gives its `texture` (none when unset or unknown), and a cube no collection contains gets `Texture.getDefault()`. Mesh faces keep `Face.getTexture`, and
    with collections present the cube controller draws each face with the texture `getTexture` returns, its UVs by
    that texture's UV size (cube.js:1272-1290, 1355-1368); the layer composite still comes first. BAMO's
    `bamo_model`, Free Rotation's `free_rotation`, Java Block Sequencer's `java_block_sequence`, Cosmic Reach's
    `cosmic_reach_model` and Easy Model Entities' `eme_entity` set none of these flags, and no plugin sets
    `per_group_texture`. ModelShot reads a plugin format as if the plugin were installed; an id no rule names keeps
    per-face textures and the project resolution.

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

A strip has at most as many frames as its image has rows (so ≤ `maxTextureSide`, and a `back_and_forth` order ≤
2 · `maxTextureSide` entries). `frame_order` has its own bound, `MAX_FRAME_ORDER_CHARS` (65 536 characters, not
`maxStringChars`: imported `.mcmeta` animations write `index:time` tokens and run long), and a `custom` order with
tokens that are no number is expanded only up to `MAX_FRAME_ORDER_LENGTH` (8192 steps). Over either bound the load
warns and goes on; neither ever fails it.

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

| code                  | when                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `UNSUPPORTED_ELEMENT` | an element type other than `cube` or `mesh`; skipped                                                                        |
| `UNSUPPORTED_VALUE`   | an unknown `render_order`, `render_sides`, `render_mode` or `shading` string; the default is used                           |
| `UNKNOWN_REFERENCE`   | an outliner entry names a uuid no element has (skipped), or an optifine group or Hytale collection `texture` no texture has |
| `SOURCE_NOT_FETCHED`  | a texture `source` that is not a data URI (a URL or file path); never fetched                                               |
| `MISSING_TEXTURE`     | no embedded image and no matching picked file; the texture is `missing`                                                     |
| `UNSUPPORTED_CHANNEL` | an animation part not played as authored (Not yet supported); once per animation, animator and channel                      |

Textures in an animating format warn `UNSUPPORTED_VALUE` for a `frame_time`, `fps`, `frame_order_type`,
`frame_order` or `frame_interpolate` of the wrong type or out of range (the default is used), for a `frame_order`
over `MAX_FRAME_ORDER_CHARS` (plain order), for `custom` tokens that are negative or too large (frame 0 plays there),
for a `custom` order whose tokens that are no number repeat over more than `MAX_FRAME_ORDER_LENGTH` steps (those
tokens are dropped), and for a strip whose frames would be under one pixel tall (more frames than image rows; drawn
as one image).

Textures also warn `UNSUPPORTED_VALUE` for a `render_mode` that is no known mode, of any type (`default` is used),
and for a `visible` or `use_as_default` that is no boolean (`true` and `false` are used); in `optifine_entity` and
`optifine_part` a group `texture` that is no string warns `UNSUPPORTED_VALUE` (ignored) and one naming no texture
`UNKNOWN_REFERENCE` (the group's faces are untextured); in `hytale_character` and `hytale_prop` a `collections`
entry that is no object warns `UNSUPPORTED_VALUE` at `$.collections[i]` (counted as an empty collection; Blockbench
cannot open a file with a `null` entry), as do a `children` that is no array at `$.collections[i].children`
(ignored), a `scope` that is no number and no string `parseFloat` reads (`"x"`, `""`, `true`), or any array or
object (Blockbench would turn an array such as `[2]` into 2; ModelShot ignores it with a warning), at
`$.collections[i].scope` or, on a cube, at `$.elements[i].scope` (ignored; `null` is skipped silently) and a `texture` that is no string at
`$.collections[i].texture` (the collection's cubes are untextured), while a `texture` naming no texture warns
`UNKNOWN_REFERENCE` there (untextured too); a child that is no uuid string is skipped silently, and other formats do
not read `collections`; in `image`, `optifine_entity` and `optifine_part` a
`uv_width` or `uv_height` that is no positive number warns `UNSUPPORTED_VALUE` (the resolution is used). None of
these fails a file: the fields were ignored before MS-29.

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

MS-27 reads frame strips, a behaviour change for files that loaded before: in the five animating formats every face
on a strip texture now maps into frame 0, as Blockbench shows it, where it used to span the whole strip (all frames
squeezed onto the face), and the texture gains `frames`. Such models render differently from earlier releases.
Every other file loads exactly as before, and frame fields only ever warn (wrong types, an over-long `frame_order`),
so no file that loaded before fails.

MS-29 reads texture render modes and Blockbench's default-texture rule, a behaviour change for files that loaded
before: an `emissive` texture's material becomes `alphaMode: "mask"` with `alphaEmission` (its partly transparent
texels now draw opaque, as in Blockbench); `additive` gains `blending`; in the single-texture formats a file with a
`layered` texture gets one more material that every face uses, and faces show the default texture (Conversion), so
blank faces of a `bedrock` model that used to draw untextured now show its texture, and faces that stored another
texture show the default one; a mesh face with `texture: null` in those formats draws with the default texture.
`image`, `optifine_entity` and `optifine_part` now read per-texture UV size, so their face UVs follow the shown
texture's `uv_width`/`uv_height` where they differ from the resolution. Files in `free` and `java_block` without
render modes load exactly as before; the new
fields only ever warn, so no file that loaded before fails. Reload affected models; scene documents need no
migration (scene format version 1, [Versioning](scene-format.md#versioning)).

MS-45 animates strips in more formats, a behaviour change for files that loaded before: in `image` and the plugin
formats `geckolib_model`, `animated_entity_model`, `azure_model`, `bamo_model`, `free_rotation`,
`java_block_sequence` and `cosmic_reach_entity_model`, faces on a strip texture now map into frame 0 and the texture
gains `frames`; where Blockbench has `texture_mcmeta` (`geckolib_model`, `free_rotation`, `java_block_sequence`) the frame
time follows `frame_time` ticks. A file whose `meta.model_format` is absent, empty, `null`, `false` or `0` now follows Blockbench's
compatibility rule: `java_block` rules, or `bedrock_old` when `meta.bone_rig` is truthy, where every rule used to treat
it as an unknown format; its `source.modelFormat` stays `unknown`. Files with `null`, `false` or `0` there used to fail with `INVALID_FIELD` and now load. Frame fields only ever warn, so no file that loaded
before fails.

MS-51 applies the texture rules of Blockbench plugin formats, a behaviour change for files that loaded before: in
`geckolib_model`, `animated_entity_model`, `azure_model`, `cosmic_reach_entity_model` and `optifine_player_model`
every face (except `texture: null`) now shows the default texture and a `layered` texture composites, as in
`bedrock`; in `figura`, `hytale_character` and `hytale_prop` `uv_width`/`uv_height` now set a texture's UV space;
the Hytale formats also show the default texture on every cube and mesh face without `collections`; with them a
cube shows the texture of the first collection containing it, any other cube the default texture, and meshes the
default texture on blank faces only; they also honour `use_as_default`, composite `layered` textures and keep fractional box-UV sizes. `bamo_model`,
`free_rotation`, `java_block_sequence`, `cosmic_reach_model`, `eme_entity` and every other format load exactly as
before. A bad `uv_width`/`uv_height` in the newly read formats and a malformed Hytale `collections` entry only
warn, so no file that loaded before fails.
Reload affected models; scene documents need no migration.

MS-50 reads reversed cube axes as Blockbench draws them, a behaviour change for files that loaded before: a cube
with from > to on an axis, a negative stretch or a negative inflate larger than half a side used to load as an
outward box (or, for the inflate, collapsed flat) and now loads mirrored on that axis, an inverted hull when an odd
number of axes is reversed, whose `auto`-sided and untextured faces are single-sided (Conversion). Every other cube loads exactly as before; no file that loaded before fails.
Reload affected models; scene documents need no migration.

## Local-first

A model never causes a network request or a file read: texture URLs and paths in the file are only used as names to
match against the files the caller passed in `textureFiles`.
