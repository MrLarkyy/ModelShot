# Look presets

A look preset is everything that makes one look, as data: the light rig (key, fill, rim), the environment, the
backdrop, the shadow catcher's strength, the rounded edges and the tone mapping with its grade. `@modelshot/looks`
defines it (`LookPreset`), checks it (`checkLookPreset`, `parseLookPreset`) and ships three (`LOOK_PRESETS`):
**Studio** (`studio`, the default `DEFAULT_LOOK`: the v0 look), **Marketplace** (`marketplace`: navy gradient, a cool
rim, a saturated grade) and **Rim** (`rim`: dark, a strong white rim). The realtime preview, the path tracer and the
light bake read the same object; no source branches on a preset id (`noPresetBranches.test.ts`).

```ts
import { LOOK_PRESETS, parseLookPreset } from '@modelshot/looks';

const look = LOOK_PRESETS['marketplace'];
const preview = RealtimeRenderer.create(canvas, { look });
const tracer = PathTracer.create(renderCanvas, { look });
const { lighting } = await baker.bake(doc, { look });
preview.setLook(parseLookPreset(fileText)); // throws LookPresetError, changes nothing
```

## Format v1

A JSON object, `format` `"modelshot-look"`, `version` `1`. Every field below is required and no other is allowed, at
any level. Colours are scene-linear Rec.709 triples, directions triples toward the light, world space (a model faces
−z, so `+z` is behind it) but for the rim's, which is in view space.

| field                                     | type and range                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `format`                                  | `"modelshot-look"`                                                                         |
| `version`                                 | `1`                                                                                        |
| `id`                                      | `[a-z0-9-]{1,32}`                                                                          |
| `name`                                    | 1..64 code points, well-formed (no lone surrogate), no control characters (C0, DEL, C1)    |
| `lights.key.direction`                    | components -1000..1000; non-zero; normalised; at least 5° above the horizon (y ≥ sin 5°)   |
| `lights.key.color`                        | 0..16 per channel                                                                          |
| `lights.key.angularRadius`                | 0..0.1 radians: the disc that softens shadows                                              |
| `lights.fill.direction`, `.rim.direction` | components -1000..1000; non-zero; normalised; the rim's in view space (below)              |
| `lights.fill.color`, `.rim.color`         | 0..16 per channel                                                                          |
| `lights.rim.exponent`                     | 1..16: how close to the silhouette the rim stays                                           |
| `lights.rim.albedoShare`                  | 0..1: 0 the rim keeps its own colour on any texel, 1 the texel tints it like diffuse light |
| `environment.kind`                        | `"dome"`                                                                                   |
| `environment.sky`, `environment.ground`   | 0..16 per channel; each channel at least a fifth of the other's                            |
| `backdrop.top`, `backdrop.bottom`         | 0..16 per channel                                                                          |
| `catcher.strength`                        | 0..1: the share of light a fully shadowed catcher point loses                              |
| `edges.width`                             | 0..4 model units (`EdgeLook`, [realtime-renderer.md](realtime-renderer.md#edge-rounding))  |
| `edges.sharpAngleDeg`                     | 1..179                                                                                     |
| `toneMapping.kind`                        | `"agx"`                                                                                    |
| `toneMapping.exposure`                    | −6..6 stops                                                                                |
| `toneMapping.grade.slope`                 | 0..4 per channel                                                                           |
| `toneMapping.grade.offset`                | −1..1 per channel                                                                          |
| `toneMapping.grade.power`                 | 0.1..4 per channel                                                                         |
| `toneMapping.grade.saturation`            | 0..2                                                                                       |

Numbers must be JSON numbers (not strings), finite. A direction within 1e-4 of unit length is kept as written (so
hand-written unit vectors stay bit-exact), any other is divided by its length. `checkLookPreset` returns a frozen deep
copy; a preset given to a renderer is checked again there, so a caller's later change of its object changes nothing.

### Errors

Every failure is a `LookPresetError` with `code` and `path` (`lights.key.direction[1]`; empty for the root), its
message starting with the path:

| code          | when                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `TOO_LARGE`   | text over `MAX_LOOK_PRESET_LENGTH` (65 536 characters), before parsing     |
| `SYNTAX`      | not JSON                                                                   |
| `FORMAT`      | `format` is not `modelshot-look`                                           |
| `VERSION`     | `version` is not 1; a higher number says it is newer than this build reads |
| `TYPE`        | not an object, not an array of three, not a finite number, not a string    |
| `MISSING`     | a required field is absent                                                 |
| `UNKNOWN_KEY` | a field v1 does not define (`__proto__` included)                          |
| `RANGE`       | a number outside its range                                                 |
| `VALUE`       | `id`, `name` or a `kind` not allowed                                       |
| `DIRECTION`   | a zero direction, or a key under 5° above the horizon                      |
| `DOME`        | sky or ground under a fifth of the other: the dome would go negative       |

The checker reads only the known fields of each object, so a hostile value (deep nesting, huge arrays) costs a key
scan and fails on its type at once; the text cap bounds `JSON.parse`. `setLook` and the renderers' `look` option throw
the same error and keep the previous look.

### Versioning

A field added later is optional with a default that reproduces the v1 image, and its addition is documented here
(MS-18 adds rounded-edge highlight fields under `edges` this way); v1 files stay valid and a reader that knows the
field fills it in. Removing a field, changing a range, a meaning or a default is breaking and raises `version`
(`LOOK_FORMAT_VERSION`); a file of a higher version fails with `VERSION`. Before v1 first shipped the rim changed from
a world-space diffuse light to the view-relative grazing one with the required `exponent` and `albedoShare` (MS-19
round 4); no v1 file existed outside this repository, so the version stayed 1. Shipped presets are files in
`packages/looks/src/presets/` and go through `parseLookPreset` like any file a user picks.

## Lighting model

- **Environment**: an analytic sky/ground dome, radiance `mix(ground, sky, ½ + ¾ d.y)` along a direction d. Its cosine
  integral over the hemisphere around a normal n is the preview's `hemisphereFill(n) = mix(ground, sky, ½ + ½ n.y)`, so
  the path tracer converges to the preview's fill on an unoccluded surface. The checker keeps it non-negative. An
  image-based environment (an HDR equirect) is a later `environment.kind`.
- **Key**: a directional disc light; it is the one that casts shadows (the path tracer's shadow rays, the light bake's
  visibility, the shadow catcher, whose plane extends along the key).
- **Fill**: a world-space directional accent, `albedo × color × max(n · direction, 0)`.
- **Rim**: a view-relative grazing accent, added as radiance (not a multiple of the albedo):
  `color × (1 − clamp(n · v, 0, 1))^exponent × max(n · l, 0) × mix(1, albedo, albedoShare)`, v the unit vector from
  the point toward the eye (the orthographic view direction reversed), l the rim's `direction` turned from **view
  space** (x right, y up, z toward the camera) into world space every frame (`rimWorldDirection`), so it lights the
  same screen side from every orbit yaw. A face turned to the eye gets exactly 0 (no blow-out from any yaw); normals
  that graze the view, the rounded edges along the silhouettes (`edges.width`), get the most, a thin line; with a low
  `albedoShare` the line stays near white on a saturated texel. Without rounded edges a flat cube shows only faces
  that already graze the view. At the default pitch 20 a face turned up grazes almost as much as a side
  silhouette's fillet (n · v 0.34 against 0.24), so the exponent alone cannot spare it: a rim direction low in view y
  and behind (both shipped rims: y 0.12, z −0.42) has `n · l` ≤ 0 there, and upward faces keep their texel colour at
  pitches above about 16°.
- **Both accents** cast **no shadow in any renderer**: the preview adds them to baked and unbaked shading alike, the
  path tracer adds them at the camera hit only, without a ray (as the preview has no accent bounce; no random
  dimension, so seeds and the sample table are unchanged), the rim seen back along the camera ray; the bake ignores
  them (they apply at draw time) and the shadow catcher does not see them.
- **Backdrop**: a gradient in screen space, `bottom + (top − bottom) × y` with y = `gl_FragCoord.y / frame height`
  (0 at the bottom edge, 1 at the top; the full frame, never a path-tracer tile), drawn behind the model on both
  preview paths, shown by the path tracer's escaped camera rays and before its first sample. A shadow-catcher point
  shows the backdrop of its pixel times `catcherShade`. `backdropColor(look, y)` mirrors it.
- **Tone mapping**: scene-linear × 2^exposure → AgX (inset, log encoding, contrast curve) → the grade (ASC CDL
  `pow(max(v × slope + offset, 0), power)`, then saturation about Rec.709 luma, in AgX's curve space as in Wrensch's
  minimal AgX "look") → outset. A neutral grade (slope 1, offset 0, power 1, saturation 1) is skipped, not evaluated,
  so it is bit-identical to plain AgX. `agxToneMap(linear, toneMapping)` mirrors it.

The shaders read the look from uniforms (`LOOK_UNIFORM_NAMES`, declared by the `lightRig`, `backdrop`, `shadowCatcher`
and `agx` chunks); `uploadLookUniforms(gl, locate, look, frameHeight, view)` uploads them into the program in use, once
per program per frame (the bake once per draw), skipping a uniform the program does not use. `view` is the frame's
camera as `lookView({ position, right, up, forward, orthographic })` gives it (`LookView`: the basis and the eye, a
point with w 1 or the back direction with w 0); the rim's world direction and the eye follow it. The bake, which has no
rim, passes `LOOK_VIEW_NONE`. `rimLight` and `unoccludedRadiance(rig, albedo, n, { v, view })` mirror the shading.

## Baked light and `lightingKey`

Baked light (`BakedLighting`) stores the key's visibility and the fill as a share of `hemisphereFill(n)`: both depend
on the key's direction and disc and on the dome, nothing else. `lightingKey(look)` is a canonical string of exactly
those (`key.direction`, `key.angularRadius`, `environment.sky`, `environment.ground`). `LightBaker.bake({ look })`
stamps it on the result; `RealtimeRenderer.setLighting` refuses (returns `false`) light whose `lightingKey` is not the
current look's, and `setLook` to a look of another key drops the shown light (the preview shows the unbaked look until
light baked under the new one is set). Looks that differ only in colours, accents, backdrop, catcher strength, edges or
grading share baked light.

## Presets

| preset      | key                                 | accents                                             | dome, backdrop                             | grade                                  |
| ----------- | ----------------------------------- | --------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Studio      | v0: above, behind right, warm white | none (black)                                        | v0 grey dome, flat grey (0.14, 0.15, 0.17) | neutral                                |
| Marketplace | front, above, warm                  | narrow white rim screen left, behind; dim blue fill | dim blue dome; navy gradient, lighter low  | exposure 0, power 1.1, saturation 1.15 |
| Rim         | weak, front                         | white rim screen right, behind                      | low dome; dark grey gradient               | power 1.25                             |

Studio is the v0 look number for number (`LIGHT_RIG_V0`, `EDGE_LOOK_V0`; tested), so every golden from before look
presets holds unregenerated. Every preset rounds edges at 30°, so switching presets never detects sharp edges again.
Marketplace's numbers are matched by the look review page (`tools/harness/fixtures/review.html`,
[testing.md](testing.md#look-presets)) against reference renders kept outside the repository. Its rim (view direction
(−0.9, 0.12, −0.42): screen left, a little up, behind; colour (12, 13, 15), exponent 6, albedo share 0.15) draws a
thin near-white line along the rounded edges of the silhouettes from any yaw, as the references do, on light and
saturated textures alike; faces turned to the camera or up (pitch 20) keep their texel colour. Rim's rim mirrors the
direction to screen right (colour 4, exponent 5, albedo share 0.3; a narrower one breaks its preview-vs-render pair
limit, [testing.md](testing.md#look-presets)), so its screen-right side faces brighten a little. Studio's rim is black (exponent 4, albedo share 1: inert).
