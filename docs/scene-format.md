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

`source` per format (`SceneSourceFormat`):

| `format`    | from                                               | `formatVersion`                      | `modelFormat`                                               |
| ----------- | -------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `'bbmodel'` | `loadBbmodel` ([bbmodel.md](bbmodel.md))           | `meta.format_version`, e.g. `'4.10'` | Blockbench project format (`'free'`, …), `'unknown'` absent |
| `'gltf'`    | `loadGltf`, `.gltf` or `.glb` ([gltf.md](gltf.md)) | `asset.version`, e.g. `'2.0'`        | the container, `'gltf'` or `'glb'`                          |
| `'obj'`     | `loadObj` ([obj.md](obj.md))                       | `''` (OBJ has no version)            | `'obj'`                                                     |
| `'player'`  | `createPlayerModel` ([player.md](player.md))       | skin layout, `'64x64'` or `'64x32'`  | the arms, `'classic'` or `'slim'`                           |

### `SceneNode`

`{ name, sourceId, parent, children, pivot, rotation, restRotation?, translation, visible, meshes }`

Nodes use Blockbench's rest-space convention: `pivot` is an absolute point in model space (not relative to the parent),
and

```
local = T(translation) · T(pivot) · Rz · Ry · Rx · T(−pivot)
world = parent.world · local          (a root node: world = local)
```

`translation` is the pose offset and 0 at rest. `visible: false` hides the node and its whole subtree. `parent` is
always lower than the node's own index, so `worldMatrices(nodes)` computes every world matrix in one pass. `sourceId`
is the identifier in the source file (a Blockbench uuid) or `''`. `restRotation`, absent unless `poseScene` or
`attachModel` set it, is the rotation without the pose; absent means `rotation` is the rest rotation.

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

### `SceneTexture`

`{ name, mimeType: 'image/png', bytes, width, height, uvWidth, uvHeight, missing }`

`bytes` is the encoded PNG as the file had it; model loaders only check its header, and `loadSkin` decodes a legacy
skin's pixels once to set `legacyHatOpaque` ([player.md](player.md#legacy-hat)). `width` × `height` is the pixel size
from the PNG header. UVs were normalised by `uvWidth` × `uvHeight`, the model's texture space; one UV unit therefore
covers `width / uvWidth` pixels (a 32×32 image on a 16×16 UV space has 2×2 pixels per unit). A texture the model
references but whose image was neither embedded nor supplied has `missing: true`, `bytes: null` and size 0; renderers
show a placeholder.

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
their rest rotation. `scale` is uniform in (0, 16] (normals stay unit length), `offset` and `rotation` follow the pose
limits; bad options throw a `RangeError` naming the path. The record `{ name, bone, node, offset, rotation, scale,
source }` is appended to `attachments` (the item's own records follow, remapped). The host's `pose` record is kept, the
item's dropped while its nodes keep their posed rotation and `restRotation`; the next `poseScene` of the merged
document returns them to rest. The renderers read only the merged nodes and
meshes, so the realtime preview and the path tracer cannot disagree on where an attachment is.

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

## Loaders

- Blockbench `.bbmodel`: [bbmodel.md](bbmodel.md).
- glTF 2.0 `.gltf` / `.glb` (static meshes): [gltf.md](gltf.md).
- Wavefront `.obj` with `.mtl`: [obj.md](obj.md).
- Player skins (`loadSkin`, `createPlayerModel`): [player.md](player.md).
