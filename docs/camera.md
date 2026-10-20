# Camera

## One definition

`SceneCamera` (`@modelshot/scene`) is the only camera definition; the realtime preview and the path tracer both
read it, so they frame a model identically.

| field                | meaning                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `position`, `target` | world space of the scene format: model units (1 = 1/16 block), y up, right-handed                                                 |
| `up`                 | approximate up; need not be orthogonal to the view direction (a parallel one falls back to +z, then +x)                           |
| `projection`         | `{ kind: 'perspective', fovYDeg }` (vertical field of view) or `{ kind: 'orthographic', height }` (visible height in model units) |
| `near`, `far`        | clip distances along the view direction, `0 < near < far`                                                                         |

The horizontal extent follows from the viewport aspect (width / height). The camera is not part of
`SceneDocument`; the scene format version is unchanged.

- `cameraView(camera)`: world to view (column-major, OpenGL convention, looking down −z).
- `cameraProjection(camera, aspect)`: view to clip, z in −1..1.
- `cameraRay(camera, aspect, ndcX, ndcY)`: the primary ray through normalised device coordinates (−1..1, y up).
  Every point on it projects back to the same coordinates through `cameraProjection × cameraView`
  (`cameraRay.test.ts` checks pixel centres of three aspects in both projections to 1e-9). Perspective rays start at
  the camera position, orthographic rays on the plane through it. For pixel (x, y) of a w × h image with y down:
  `ndcX = (x + 0.5) / w × 2 − 1`, `ndcY = 1 − (y + 0.5) / h × 2`.

## Orbit angles

`orbitDirection(yawDeg, pitchDeg)` is the unit vector from the target to the camera: yaw 0 puts the camera on +z
(the south side of a Blockbench model), yaw 90 on +x; positive pitch looks down from above. The isometric preset is
yaw 45°, pitch atan(1/√2) ≈ 35.264° (`ISOMETRIC_YAW_DEG`, `ISOMETRIC_PITCH_DEG`), orthographic.

## Frame-to-fit and clip planes

`sceneBounds(doc)` returns the world-space box of the visible meshes (hidden nodes hide their subtree, non-finite
vertices are skipped) and its circumscribed sphere (radius half the box diagonal), or `null` for an empty scene.
`frameToFit(bounds, { projection, aspect, yawDeg, pitchDeg, margin })` places the camera so the whole sphere, and
therefore every box corner, is inside the frustum along both image axes, with 10 % room by default; orthographic
cameras stand at twice the radius. A point-sized model is framed as a sphere of radius 0.5.

`fitClipPlanes(position, forward, bounds)` encloses the sphere: `far` = distance to the far side + 1 %, `near` = distance
to the near side − 1 %, never below `far × 1e-4` (a camera inside the sphere after panning). The orbit controller
fits them on every `camera()` call, so zooming never clips the model.

## Orbit controller

`OrbitController` (`@modelshot/renderer-rt`) holds the view state and produces `SceneCamera`. It is pure state: no
DOM, no clock.

| operation                           | range                                                             |
| ----------------------------------- | ----------------------------------------------------------------- |
| `rotate(dYaw, dPitch)`, `setAngles` | pitch clamped to ±89.5° so the view never flips                   |
| `zoom(factor)` perspective          | distance from the target in [1.05 × radius, 8 × the fit distance] |
| `zoom(factor)` orthographic         | height in [fit / 16, 8 × fit]                                     |
| `pan(dxPx, dyPx, viewportHeightPx)` | moves the target in the view plane; the model follows the pointer |
| `setFov(deg)`                       | 10..100°, the apparent size at the target stays                   |
| `setProjection(kind)`               | keeps the apparent size at the target                             |
| `isometric()`                       | orthographic at the isometric angles, framed to fit               |
| `reset(bounds)`                     | frame-to-fit from the initial angles; also the initial view       |

Damping (default on, 80 ms time constant) eases the camera towards the input goal in `update(dtMs)`, which returns
whether it is still moving; once within 1e-6 of the goal it snaps to it, so with no input the state stays
bit-identical forever (tested over 10,000 steps). `update(0)` changes nothing. Non-finite input (NaN or infinite
angles, deltas, zoom factors, field of view or options) is ignored, so the camera always stays defined; a
non-finite, zero or negative `dampingMs` falls back to 80 ms.

## Input

`bindOrbitInput(element, controller, { onChange })` uses pointer events with pointer capture:

- mouse: left drag orbits; right, middle or Shift + left drag pans; the wheel dollies (page scrolling prevented);
- touch: one finger orbits, two fingers pinch-zoom and pan together;
- keys on the focused element: arrows orbit, Shift + arrows pan, + / − zoom, Home or 0 reset, O toggles
  orthographic, I isometric. Other keys and any key with Ctrl, Alt or Meta are left to the page.

The element gets `tabindex="0"` when it has none and `touch-action: none`. While `prefers-reduced-motion: reduce`
is set damping is off, following changes of the setting (a controller created without damping stays without). Labels and the visible focus style belong to the app. The returned function removes every
listener.
