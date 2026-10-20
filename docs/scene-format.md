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
| `materials`     | `SceneMaterial[]`                                                   | `{ name, texture }`; `texture` −1 for none  |
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

| field       | type                           | per vertex                                     |
| ----------- | ------------------------------ | ---------------------------------------------- |
| `positions` | `Float32Array`                 | 3: model rest space                            |
| `normals`   | `Float32Array`                 | 3: unit length, outwards                       |
| `uvs`       | `Float32Array`                 | 2: normalised, top-left origin                 |
| `uvRects`   | `Float32Array`                 | 4: `uMin, vMin, uMax, vMax` of the vertex face |
| `indices`   | `Uint32Array`                  | 3 per triangle                                 |
| `groups`    | `{ material, start, count }[]` | index ranges per material (−1: no material)    |

Also `name`, `sourceId`, `node` (owning node, −1 for the model root with an identity world matrix) and `visible`.

Vertices are in **model rest space**: the source element's own rotation is already applied, the owning node's world
matrix is not. To draw a mesh, transform its vertices by `worldMatrices(nodes)[mesh.node]` (identity for −1).

`uvRects` exist for pixel art: a renderer that anti-aliases texel edges clamps its sample footprint to the face's
rectangle, so a face never shows texels of a neighbouring region of the texture atlas. All four vertices of a face
carry the same rectangle. UVs are not inset; with power-of-two UV sizes the corners land exactly on texel edges.

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

## Loaders

- Blockbench `.bbmodel`: [bbmodel.md](bbmodel.md).
