# Scene format v1

`@modelshot/scene` defines the scene format: the one in-memory description of a model that every loader produces and
every renderer, exporter and the embed consume. Loaders never hand renderers anything else, so a fix in one loader
reaches the realtime preview and the path tracer alike.

```ts
import type { SceneDocument } from '@modelshot/scene';
```

## Conventions

- **Units**: 1 unit = 1/16 of a block (one Blockbench pixel).
- **Axes**: y up, right-handed. Blockbench names: north = −Z, south = +Z, east = +X, west = −X.
- **Cross references** are array indices; −1 means "none".
- **Rotations** are Euler angles in degrees, applied X first, then Y, then Z: the rotation matrix is `Rz · Ry · Rx`
  (three.js order `'ZYX'`, as Blockbench uses). Positive angles turn counter-clockwise looking down the axis towards
  the origin (right-hand rule).
- **Matrices** (`Mat4`) are column-major `Float64Array(16)`, as WebGL expects.
- **UVs** are normalised to 0–1 with the origin at the **top-left** of the image and v growing downwards. Upload
  textures without flipping (`UNPACK_FLIP_Y_WEBGL` false).
- **Winding**: triangles are counter-clockwise seen from outside; `normals` point outwards.
- A loaded scene is deterministic: the same file gives the same document, with no clock, randomness or generated ids.

## `SceneDocument`

| field           | type                                                                               | meaning                                     |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `formatVersion` | `1`                                                                                | `SCENE_FORMAT_VERSION`                      |
| `source`        | `{ format: 'bbmodel' \| 'gltf' \| 'obj' \| 'player', formatVersion, modelFormat }` | where the scene came from (below)           |
| `nodes`         | `SceneNode[]`                                                                      | groups / bones, **parents before children** |
| `rootNodes`     | `number[]`                                                                         | nodes without a parent, in source order     |
| `meshes`        | `SceneMesh[]`                                                                      | triangle meshes                             |
| `materials`     | `SceneMaterial[]`                                                                  | see [SceneMaterial](#scenematerial)         |
| `textures`      | `SceneTexture[]`                                                                   | PNG images                                  |
| `pose?`         | `ScenePose`                                                                        | last `poseScene` pose; absent: none applied |
| `attachments?`  | `SceneAttachment[]`                                                                | models merged under a bone; absent: none    |
| `animations?`   | `SceneAnimation[]`                                                                 | keyframed clips; absent: none               |
| `playback?`     | `ScenePlayback`                                                                    | last `animateScene` frame; absent: none     |

`source` per format (`SceneSourceFormat`):

| `format`    | from                                               | `formatVersion`                      | `modelFormat`                                               |
| ----------- | -------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `'bbmodel'` | `loadBbmodel` ([bbmodel.md](bbmodel.md))           | `meta.format_version`, e.g. `'4.10'` | Blockbench project format (`'free'`, …), `'unknown'` absent |
| `'gltf'`    | `loadGltf`, `.gltf` or `.glb` ([gltf.md](gltf.md)) | `asset.version`, e.g. `'2.0'`        | the container, `'gltf'` or `'glb'`                          |
| `'obj'`     | `loadObj` ([obj.md](obj.md))                       | `''` (OBJ has no version)            | `'obj'`                                                     |
| `'player'`  | `createPlayerModel` ([player.md](player.md))       | skin layout, `'64x64'` or `'64x32'`  | the arms, `'classic'` or `'slim'`                           |

### `SceneNode`

`{ name, sourceId, parent, children, pivot, rotation, restRotation?, translation, scale?, visible, meshes }`

Nodes use Blockbench's rest-space convention: `pivot` is an absolute point in model space (not relative to the parent),
and

```
local = T(translation) · T(pivot) · Rz · Ry · Rx · S(scale) · T(−pivot)
world = parent.world · local          (a root node: world = local)
```

`translation` is the pose offset and 0 at rest. `visible: false` hides the node and its whole subtree. `parent` is
always lower than the node's own index, so `worldMatrices(nodes)` computes every world matrix in one pass. `sourceId`
is the identifier in the source file (a Blockbench uuid) or `''`. `restRotation`, absent unless `poseScene` or
`attachModel` set it, is the rotation without the pose; absent means `rotation` is the rest rotation. `scale`, absent
unless `animateScene` set it (absent: 1 on every axis, which rest always is), scales about the pivot before the
rotation (three.js `T · R · S`, as Blockbench bones); it is always positive, so no node matrix mirrors or collapses.
With a scale the upper 3×3 of a world matrix no longer maps normals: both renderers use `mat4NormalMatrix(world)` (the
cofactor matrix, i.e. the inverse transpose up to a positive factor) and normalise, `normalMatrixTransform` applies it.

### `SceneMesh`

| field       | type               | per vertex                                     |
| ----------- | ------------------ | ---------------------------------------------- |
| `positions` | `Float32Array`     | 3: model rest space                            |
| `normals`   | `Float32Array`     | 3: unit length, outwards                       |
| `uvs`       | `Float32Array`     | 2: normalised, top-left origin                 |
| `uvRects`   | `Float32Array`     | 4: `uMin, vMin, uMax, vMax` of the vertex face |
| `indices`   | `Uint32Array`      | 3 per triangle                                 |
| `groups`    | `SceneMeshGroup[]` | index ranges, see below                        |

Also `name`, `sourceId`, `node` (owning node, −1 for the model root with an identity world matrix), `visible` and
`renderOrder`.

A group `{ material, start, count, doubleSided? }` is a run of `count` indices from `start` drawn with one material
(−1: none, the renderer's default) and one sidedness:

- `doubleSided` absent or `false` (glTF's meaning): the face has only its front (counter-clockwise) side, for
  **every** kind of ray. A ray that meets the back passes through, as if the face were not there:
  - camera rays: the back is not seen;
  - shadow rays count as travelling **from the light**: a face casts a shadow only if its front faces the light;
  - ambient-occlusion and path-tracing rays: only a hit on the front counts.
- `doubleSided: true`: both sides, for every ray. The back shows the same texels, mirrored as seen from behind (the
  UVs are the front's), and the normal is flipped toward the viewer or ray before shading.

`renderOrder` is an integer in ±1024 (`MAX_ABS_RENDER_ORDER`), absent: 0. Among the surfaces a ray meets, the one
with the smallest key is shown:

```
key = depth − (renderOrder + back) × RENDER_ORDER_TIE_DISTANCE        (0.001 units, from @modelshot/scene)
```

- depth: for a camera ray the depth along the camera's view axis (hit distance × cos of the angle between the ray and
  the view axis); for every other ray the distance along the ray;
- back: `BACK_SIDE_RENDER_ORDER` (−1/16) where the ray meets the back of a double-sided face, else 0, so of two
  coincident faces the one facing the viewer wins;
- occlusion rays (shadow, ambient occlusion) ignore order: any blocking hit blocks;
- which of two exactly equal keys is shown is unspecified.

So for orders one step apart (Blockbench's `behind` −1, `default` 0, `in_front` 1) the higher order wins when it is
at most 0.001 units farther, and the nearer surface wins when they are farther apart; `in_front` over `behind` (two
steps) gets 0.002. How a renderer realises the key is its own documentation's business
([realtime-renderer.md](realtime-renderer.md), [testing.md](testing.md) for the reference fixture).

Vertices are in **model rest space**: the source element's own rotation is already applied, the owning node's world
matrix is not. To draw a mesh, transform its vertices by `worldMatrices(nodes)[mesh.node]` (identity for −1).

`uvRects` exist for pixel art: a renderer that anti-aliases texel edges clamps its sample footprint to the face's
rectangle, so a face never shows texels of a neighbouring region of the texture atlas. All four vertices of a face
carry the same rectangle. UVs are not inset; with power-of-two UV sizes the corners land exactly on texel edges.

### `SceneMaterial`

`{ name, texture, alphaMode?, alphaCutoff? }`: `texture` indexes `textures` (−1 for none). The alpha fields follow
glTF and are read through `resolveMaterialAlpha(material)` (absent mode: `opaque`; absent or non-finite cutoff:
`DEFAULT_ALPHA_CUTOFF`, 0.5; clamped to 0–1). `texelCoverage(alpha, rule)` classifies one texel; it is the one
definition every pass uses:

| `alphaMode` | alpha `a` of the texel | coverage    |
| ----------- | ---------------------- | ----------- |
| `opaque`    | any                    | `opaque`    |
| `mask`      | `a < alphaCutoff`      | `invisible` |
| `mask`      | `a ≥ alphaCutoff`      | `opaque`    |
| `blend`     | `a < alphaCutoff`      | `invisible` |
| `blend`     | `alphaCutoff ≤ a < 1`  | `partial`   |
| `blend`     | `a = 1`                | `opaque`    |

Per pass: an `invisible` texel is skipped by camera rays, shadow rays, ambient-occlusion rays and BVH hits alike, as
if the surface had a hole there (in a rasteriser: discarded in the depth, shadow-map and colour passes). An `opaque`
texel stops every ray. A `partial` texel is drawn order-independently (never by draw order) with weight `a`, and lets
`1 − a` of the light through shadow rays. A texel exactly at the cutoff is visible.

Three more optional fields (MS-29) say how a covered texel draws; they are read through
`resolveMaterialRenderMode(material)`, the one definition (absent or unknown `blending`: `normal`; `alphaEmission`
only when `true`; absent, empty or non-array `layers`: `[texture]`; a longer stack keeps its first
`MAX_MATERIAL_LAYERS` (3) entries, a non-integer entry is −1):

| field           | meaning                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blending`      | `normal` follows `alphaMode`; `additive` adds `rgb · a` of the shaded texel to what lies behind, independent of draw order, and never occludes camera, shadow or ambient-occlusion rays (coverage still decides which texels add at all)                            |
| `alphaEmission` | alpha is an inverted emission mask: a covered texel of colour `c` reflects `c · a` and emits `c · (1 − a)`, relative to unshaded white light; the radiance scale is the renderer's (MS-32 maps it). Authored emission (MS-32) adds to this split, never replaces it |
| `layers`        | texture indices bottom to top, composited with the over operator at the face UV; the alpha rule applies to the composite alpha. Consumers bounds-check each index like `texture` (out of range: no texture)                                                         |

A consumer that ignores them still draws coverage right (`alphaMode` / `alphaCutoff` stay the rule): an
`alphaEmission` material plainly lit, an additive one blended normally, a layer stack as its `texture`. No renderer
reads them yet.

### `SceneTexture`

`{ name, mimeType: 'image/png', bytes, width, height, uvWidth, uvHeight, missing, frames? }`

`bytes` is the encoded PNG as the file had it; model loaders only check its header, and `loadSkin` decodes a legacy
skin's pixels once to set `legacyHatOpaque` ([player.md](player.md#legacy-hat)). `width` × `height` is the pixel size
from the PNG header. UVs were normalised by `uvWidth` × `uvHeight`, the model's texture space; one UV unit therefore
covers `width / uvWidth` pixels (a 32×32 image on a 16×16 UV space has 2×2 pixels per unit). On a strip (`frames`
below) v was normalised by `uvHeight` × `frames.count` instead, so the UVs fall in frame 0. A texture the model
references but whose image was neither embedded nor supplied has `missing: true`, `bytes: null` and size 0; renderers
show a placeholder.

`frames` (`SceneTextureFrames`, optional) marks the image as a vertical strip of frames, frame 0 at the top; absent,
it is a still. `count` is an integer from 2 to `height` (each frame at least one pixel tall); a frame is `width` ×
`height / count` pixels, fractional when the source rounded the count (a 16×40 image on a 16×16 UV space has 3 frames
of 13.33 px). `frameTime` is the seconds each played frame shows, finite and above 0 (absent:
`DEFAULT_TEXTURE_FRAME_TIME`, 0.05 s, one Minecraft tick); `order` the frame indices in play order, integers in
[0, `count`), non-empty (absent: 0 … count − 1 looping); `interpolate` cross-fades into the next played frame (absent:
false). Loaders store `count` only; the frame size follows from `width`/`height`. UVs of every face using the texture
are already normalised into frame 0, v in [0, 1/`count`] of the whole image; frame k is the same UV plus k/`count` in
v, so a consumer that ignores `frames` draws frame 0, the still.

## Poses

`poseScene(doc, pose)` returns `{ document, unmatchedBones }`. A `ScenePose` is `{ name, bones }` with bones
`{ bone, rotation, translation? }`: `bone` is a node name (the first node with that name is posed), `rotation` Euler
degrees added to the rest rotation, `translation` the pose offset. Every node of the result gets

```
rotation     = rest + pose rotation        (rest = restRotation ?? rotation; a node not in the pose: rest)
translation  = pose translation ?? 0
restRotation = rest
```

so a pose always applies to rest: posing B after A gives exactly B, and `poseScene(doc, null)` restores rest and
removes `pose`. `pose` records the pose `poseScene` last applied to this document; the nodes already carry it, so a
consumer that ignores `pose` draws the posed model correctly. An absent `pose` does not mean every node is at rest: a
model merged in by `attachModel` keeps its own posed rotations (its `pose` record is dropped) until the next
`poseScene`. Limits, each a `RangeError` naming the path (`pose.bones[2].rotation[1]`): at most 1024
bones, names strings of at most 1024 characters, no bone twice, rotations finite with |v| ≤ 360, translations
finite with |v| ≤ 4096. Bone names are looked up in a `Map`, so `__proto__` or `constructor` are ordinary names.
`PLAYER_POSE_PRESETS` (`idle`, `walk`, `hold`, `wave`) are frozen poses for the player rig; `playerPosePreset(name)`
looks one up by own key.

## Animations

`SceneDocument.animations` holds clips in scene units and axes (loaders convert from their file format once):
`SceneAnimation { name, loop, length, channels }` with `loop` `'once' | 'hold' | 'loop'` and `length` in seconds (the
clip's period; keyframes may lie past it and only shape the curve before it, as a trailing catmull-rom keyframe does;
the bbmodel loader takes the last keyframe's time only when the file has no length above 0). A
`SceneAnimationChannel { node, property, keyframes }` drives one node property (at most one
channel per node and property): `rotation` (Euler degrees added to the rest rotation), `translation` (the node's
`translation`) or `scale` (the node's `scale`). `SceneKeyframe { time, value, before?, interpolation }`: `value` holds
from this keyframe on, `before` is what arrives at it when it differs (Blockbench's pre and post data points),
`interpolation` `'linear' | 'catmullrom' | 'step'` says how the channel leaves it. Keyframes are sorted by time.

`animateScene(doc, { animation, time, loop? })` returns `{ document, clipTime }`: `animation` is an index or the name
of the first animation with that name, `time` seconds of playback, `loop` overrides the animation's loop mode. Every
node of the result gets

```
rotation     = rest + rotation sample      (rest = restRotation ?? rotation)
translation  = translation sample ?? 0
scale        = scale sample, clamped to [1e-4, 1e4] per axis (MIN_ANIMATION_SCALE, MAX_ANIMATION_SCALE); absent without
restRotation = rest
```

computed from rest every time, never from the previous frame: the same time gives byte-identical nodes whatever was
played or seeked before, so live playback, seeking and export agree. The result records `playback { animation, time,
loop }` and drops `pose` (the nodes no longer carry it); `animateScene(doc, null)` returns rest and drops `playback`.
`poseScene` in turn drops `scale` and `playback`: a pose always applies to rest. The scale clamp keeps every matrix
positive, so culling and winding never flip.

Time (`animationTime(animation, seconds, loop?)`): negative seconds count as 0; `loop` wraps (`seconds mod length`),
`hold` stops at `length`, `once` gives `null` after `length` and the nodes are at rest (the clip has ended, as in
Minecraft; Blockbench's editor shows the last frame there). Frames for export (`animationFrameTimes(animation, fps,
loop?)`) are `i / fps` per index, never accumulated: `loop` gives `max(1, round(length · fps))` frames (the frame
equal to frame 0 left out), `hold` and `once` `floor(length · fps) + 1` (the frame at `length` included); `fps` in
(0, 240] (`MAX_PLAYBACK_FPS`) and at most 14 400 frames (`MAX_ANIMATION_FRAMES`), else a `RangeError`.

Sampling a channel at clip time t follows Blockbench's `BoneAnimator.interpolate`:

- at or before the first keyframe: what arrives there (`before ?? value`); after the last: its `value`; exactly at a
  keyframe: what arrives there. Keyframes with equal times: time reaches the first and leaves from the last.
- between A and B: A `step` holds A's `value`; A `linear` and B `linear` or `step` interpolate linearly from A's
  `value` to what arrives at B; otherwise (A or B `catmullrom`) a uniform Catmull-Rom spline (three.js `SplineCurve`,
  tension 0.5) through A's predecessor, A, B and B's successor. A missing neighbour repeats the segment end; the
  predecessor is used only when A has no `before`, the successor only when B has none. In `loop` mode with three or
  more keyframes a missing predecessor is the next-to-last keyframe and a missing successor the second (the seam of
  a clip whose first and last keyframes match).

Validation, each a `RangeError` naming the path (`animations[0].channels[2].keyframes[1].value[0]`): options as above;
the selected animation's name (at most 1024 characters), loop, length and keyframe times in [0, 10⁶], values finite
with |v| ≤ 10⁶ (`MAX_ANIMATION_VALUE`), keyframes non-empty and sorted, node indices inside the document. It runs once
per animation object (animations are treated as immutable), so a frame costs O(channels · log keyframes + nodes); a
test keeps a frame of 10 000 nodes with 30 000 channels of 100 keyframes under 200 ms. The renderers see only nodes, so an
animated frame is a pose-only change for them (`poseOnlyChange`): the lightmap layout and sharp edges stay.

## Attachments

`attachModel(host, item, { bone, name?, offset?, rotation?, scale? })` returns `host` with `item` merged under the
node `bone` (an index, or the first node with that name). It appends an attachment node (child of `bone`, `pivot` =
the bone's pivot, rest rotation `rotation`, no meshes but the item's root meshes), then the item's nodes, meshes,
materials and textures with every index remapped (the item's root nodes become children of the attachment node). The
item's positions, pivots and translations become `scale · x + offset + pivot`, so an attached vertex lands at

```
world(bone) · T(pivot) · R(rotation) · (scale · x + offset)
```

in every pose of the host; posing the merged document again keeps it attached, and the item's own nodes go back to
their rest rotation. `scale` is uniform in (0, 16] (normals stay unit length), and an item node's own `scale` is kept, `offset` and `rotation` follow the pose
limits; bad options throw a `RangeError` naming the path. The record `{ name, bone, node, offset, rotation, scale,
source }` is appended to `attachments` (the item's own records follow, remapped). The host's `pose` record is kept, the
item's dropped while its nodes keep their posed rotation and `restRotation`; the next `poseScene` of the merged
document returns them to rest. The host's `animations` and `playback` are kept (they address host nodes, which keep
their indices); the item's are not merged. The renderers read only the merged nodes and
meshes, so the realtime preview and the path tracer cannot disagree on where an attachment is.

## Sharp edges

Rounded edges are derived from the meshes, never stored: `sharpEdges(mesh, { sharpAngleDeg, reach }, work?)` returns
per-vertex data both renderers shade with, and the renderers call `sceneSharpEdges(doc.meshes, options)`: every mesh
in order under one work budget, kept per meshes array for the latest options only (another pose of a document keeps
its meshes array, so re-posing detects nothing again; an angle change replaces the result). How the edges are rounded
is `EdgeLook` of `@modelshot/looks` ([realtime-renderer.md](realtime-renderer.md#edge-rounding)).

- Corners match by position (within `EDGE_WELD_DISTANCE`, 10⁻⁴ units), so a Blockbench cube's faces, each with its
  own four vertices, still share their edges. Detection is per `SceneMesh`: edges are never welded across meshes, as
  Blockbench draws each element on its own.
- An edge is sharp where exactly two triangles with area and finite corners meet, the angle between their normals is
  at least `sharpAngleDeg` (`EDGE_LOOK_V0`: 30°) and below `MAX_SHARP_ANGLE_DEG` (170°), and the vertex normals differ
  there. So a plane's boundary, an edge of three or more triangles, the folded rim of a zero-thickness card (front
  and back faces, 180°) and a smooth-shaded edge (equal normals) are never sharp.
- Triangles joined across the other edges form patches (a cube face, a smooth area). Each triangle takes up to
  `EDGE_SLOTS` (4) sharp edges of its patch: those it lies beside (its projection onto the edge overlaps the segment,
  so a flat L, U or frame does not carry an inner edge across the corner square beyond its end), with all its corners
  on their interior side and within `reach` (`MAX_EDGE_WIDTH`, 4 units), the nearest first. An edge whose inward
  direction is within `PARALLEL_EDGE_DEG` (30°) of a kept one's is skipped: the nearly parallel rim segments of a
  smooth cylinder would otherwise bend the normal two or three times over (72° instead of 45° at the rim). The kept
  edges are stored in a fixed order. A vertex shared by triangles with different slots is
  split (`vertexOf`, with `indices` replacing the mesh's in the same triangle order); a cube face never is.
- Per vertex and slot: the distance to the edge's line in the triangle's plane toward the interior (never negative;
  affine over the triangle, so interpolation is exact), `NO_EDGE` (10⁶) in an empty slot; and the angle between the
  face normals in radians, negative for a crease, 0 when empty.
- Pure and deterministic (edges, patches and split vertices in order of first appearance). Positions, edges, slot
  sets and split vertices are matched by sorting exact integer keys (quantised coordinates ranked per axis, id pairs),
  never by a hash table a model could crowd: O(n log n) whatever the positions (about 0.45 s for 200 000 triangles
  of cubes; 0.15 s for 400 000 vertices on a 65 536-unit grid, where the earlier open-addressing tables put every
  vertex into one probe chain and took about two minutes). The slot search, the only part that is not near-linear, is bounded per document by work,
  not by a count of checks: `MAX_EDGE_WORK` (10⁸ units of about 5 ns: 1 per candidate edge visited, 5 more to test
  whether the triangle lies beside it, 20 more to measure its distance, 1 per place it moves in the order), shared by
  all meshes of the document in order. Once spent, every later triangle of that mesh and the later meshes round
  nothing: fail-safe (flat shading), and a count, never a clock, so the result and the goldens do not depend on the
  machine. Nine walled plates of fine cells (`edges-hostile`, 187 200 triangles) stop at it after about 0.4 s instead
  of about 30 s.

## Versioning

`formatVersion` is 1. A change that only adds **optional** fields with a defined default keeps version 1 (consumers
ignore what they do not know). Anything else (a removed, renamed or retyped field, a new required field, a changed
convention above) bumps `SCENE_FORMAT_VERSION` and ships a migration from every older version.

Added within version 1 (MS-12), each optional with the old meaning as its default: `SceneMaterial.alphaMode`
(`opaque`) and `alphaCutoff` (0.5), `SceneMeshGroup.doubleSided` (`false`), `SceneMesh.renderOrder` (0), and the
exports `resolveMaterialAlpha`, `texelCoverage`, `DEFAULT_ALPHA_CUTOFF` and `RENDER_ORDER_TIE_DISTANCE`. A
consumer that ignores them draws every material opaque, every face single-sided and ignores render order, which is
what a version-1 document meant before.

Added within version 1 (MS-13): `SceneSource.format` values `'gltf'` and `'obj'` (and the type
`SceneSourceFormat`). Existing documents keep `'bbmodel'`; a consumer that switches over the format must handle the
two new values (a TypeScript exhaustive `switch` gets a compile error until it does). Loaders of these formats use
only the fields above: transforms that a node cannot carry are baked into the vertices, and colours without a texture
are generated 1×1 PNG textures, so no renderer reads anything new.
Added within version 1 (MS-20), each optional: `SceneNode.restRotation` (absent: `rotation`),
`SceneDocument.pose` (absent: no `poseScene` pose recorded) and `SceneDocument.attachments` (absent: none); `SceneSource.format` gains
`'player'`. Poses and attachments are already applied to the nodes and meshes, so a consumer that ignores the new
fields draws a posed or attached scene correctly; no migration.
Added within version 1 (MS-15): no field. Sharp edges are derived from the meshes (`sharpEdges`, `sceneSharpEdges`,
`SharpEdgeAttributes`, `NO_EDGE` and the constants above, see Sharp edges), and how they are rounded is look data
(`EdgeLook`), so documents do not change and nothing migrates.
Added within version 1 (MS-21), each optional: `SceneNode.scale` (absent: 1), `SceneDocument.animations` (absent: none)
and `SceneDocument.playback` (absent: no frame applied); `mat4NodeLocal` takes an optional `scale`. A consumer that
ignores `animations` draws the rest pose, which a document meant before; one that draws node matrices must map normals
with `mat4NormalMatrix` once `scale` can be present (both renderers do). Loaders leave `animations` out when the file
has none, so such documents are unchanged; no migration.
Added within version 1 (MS-27), optional: `SceneTexture.frames` (absent: a still image), with the type
`SceneTextureFrames` and the export `DEFAULT_TEXTURE_FRAME_TIME`. UVs map into frame 0, so a consumer that ignores
`frames` draws the still frame as the source's own preview does; loaders leave the key out for every other texture,
so those documents are unchanged; no migration.
Added within version 1 (MS-29), each optional: `SceneMaterial.blending` (absent: `normal`), `alphaEmission`
(absent: `false`) and `layers` (absent: `[texture]`), with the type `SceneBlending`, the export
`resolveMaterialRenderMode` (type `MaterialRenderMode`) and `MAX_MATERIAL_LAYERS`. A consumer that ignores them draws
what the document meant before; the bbmodel loader leaves the keys out where a texture has no render mode, so those
documents are unchanged; no migration.

## Loaders

- Blockbench `.bbmodel`: [bbmodel.md](bbmodel.md).
- glTF 2.0 `.gltf` / `.glb` (static meshes): [gltf.md](gltf.md).
- Wavefront `.obj` with `.mtl`: [obj.md](obj.md).
- Player skins (`loadSkin`, `createPlayerModel`): [player.md](player.md).
