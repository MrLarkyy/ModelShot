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

| field           | type                                                                | meaning                                     |
| --------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| `formatVersion` | `1`                                                                 | `SCENE_FORMAT_VERSION`                      |
| `source`        | `{ format: 'bbmodel', formatVersion: string, modelFormat: string }` | where the scene came from                   |
| `nodes`         | `SceneNode[]`                                                       | groups / bones, **parents before children** |
| `rootNodes`     | `number[]`                                                          | nodes without a parent, in source order     |
| `meshes`        | `SceneMesh[]`                                                       | triangle meshes                             |
| `materials`     | `SceneMaterial[]`                                                   | see [SceneMaterial](#scenematerial)         |
| `textures`      | `SceneTexture[]`                                                    | PNG images                                  |

### `SceneNode`

`{ name, sourceId, parent, children, pivot, rotation, translation, visible, meshes }`

Nodes use Blockbench's rest-space convention: `pivot` is an absolute point in model space (not relative to the parent),
and

```
local = T(translation) · T(pivot) · Rz · Ry · Rx · T(−pivot)
world = parent.world · local          (a root node: world = local)
```

`translation` is the pose offset and 0 at rest. `visible: false` hides the node and its whole subtree. `parent` is
always lower than the node's own index, so `worldMatrices(nodes)` computes every world matrix in one pass. `sourceId`
is the identifier in the source file (a Blockbench uuid) or `''`.

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
  - camera rays (and a rasteriser's camera pass): the back is not drawn;
  - shadow rays count as travelling **from the light**: a face casts a shadow only if its front faces the light (a
    rasteriser culls back faces as seen from the light in its shadow pass);
  - ambient-occlusion and path-tracing rays: only a hit on the front counts.
- `doubleSided: true`: both sides, for every ray. The back shows the same texels, mirrored as seen from behind (the
  UVs are the front's), and the normal is flipped toward the viewer or ray before shading.

`renderOrder` (an integer, absent: 0) breaks ties between (nearly) coincident surfaces. Every renderer compares, per
pixel ray, the same key:

```
key = distance along the ray − renderOrder × RENDER_ORDER_TIE_DISTANCE      (0.001 units, from @modelshot/scene)
```

The smallest key is shown (the first one at an exactly equal key). So for orders one step apart (Blockbench's
`behind` −1, `default` 0, `in_front` 1) the higher order wins when it is at most 0.001 units farther along the ray,
and the nearer surface wins when they are farther apart; `in_front` over `behind` (two steps) gets 0.002. Surfaces of
equal order resolve by distance alone. A ray tracer computes the key from the hit distance; a rasteriser computes it
per fragment from the pixel's ray and the triangle's plane (not from interpolated positions, which are less precise
than 0.001 units) and writes it as the fragment depth with a `LESS` test and at least 24 depth bits. Neither uses a
polygon offset.

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

`bytes` is the encoded PNG (never decoded by a loader; only its header is checked). `width` × `height` is the pixel size
from the PNG header. UVs were normalised by `uvWidth` × `uvHeight`, the model's texture space; one UV unit therefore
covers `width / uvWidth` pixels (a 32×32 image on a 16×16 UV space has 2×2 pixels per unit). A texture the model
references but whose image was neither embedded nor supplied has `missing: true`, `bytes: null` and size 0; renderers
show a placeholder.

## Versioning

`formatVersion` is 1. A change that only adds **optional** fields with a defined default keeps version 1 (consumers
ignore what they do not know). Anything else (a removed, renamed or retyped field, a new required field, a changed
convention above) bumps `SCENE_FORMAT_VERSION` and ships a migration from every older version.

Added within version 1 (MS-12), each optional with the old meaning as its default: `SceneMaterial.alphaMode`
(`opaque`) and `alphaCutoff` (0.5), `SceneMeshGroup.doubleSided` (`false`), `SceneMesh.renderOrder` (0), and the
exports `resolveMaterialAlpha`, `texelCoverage`, `DEFAULT_ALPHA_CUTOFF` and `RENDER_ORDER_TIE_DISTANCE`. A
consumer that ignores them draws every material opaque, every face single-sided and ignores render order, which is
what a version-1 document meant before.

## Loaders

- Blockbench `.bbmodel`: [bbmodel.md](bbmodel.md).
