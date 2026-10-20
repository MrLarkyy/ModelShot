# Player skins and posing

`@modelshot/formats` builds Minecraft's player model from a skin PNG; `@modelshot/scene` poses it and attaches other
models to its hands. The result is an ordinary [scene document](scene-format.md), so the realtime renderer and the
path tracer draw it without knowing it is a player.

```ts
import { createPlayerModel, loadSkin } from '@modelshot/formats';
import { attachModel, playerPosePreset, poseScene } from '@modelshot/scene';

const skin = loadSkin(bytes, { name: file.name }); // bytes: Uint8Array of a file the user picked
const player = createPlayerModel(skin, { arms: 'slim' });
const posed = poseScene(player, playerPosePreset('hold') ?? null).document;
const holding = attachModel(posed, sword, { bone: 'right_hand', scale: 0.5, rotation: [0, 45, 0] });
```

## Skins

`loadSkin(bytes, { name?, limits? })` returns `{ texture, layout, legacyHatOpaque }`. The bytes are copied into the
texture and decoded by the renderer, like any model texture. A modern skin's pixels are never decoded while loading; a
legacy skin's pixels are, once, to set `legacyHatOpaque` (see [Legacy hat](#legacy-hat)). That decoder is
synchronous and bounded: at most 1024 × 512 pixels whatever `limits.maxSide` allows, image data inflated to exactly
the size the header implies and no further (not even started when that size is over 1032 times the compressed data,
more than deflate can produce); it never throws.

| image size (pixels)          | `layout` | UV space | outer layer                   |
| ---------------------------- | -------- | -------- | ----------------------------- |
| 64 · 2^k square (64, 128, …) | `modern` | 64 × 64  | hat, jacket, sleeves, pants   |
| 64 · 2^k × half (64 × 32, …) | `legacy` | 64 × 32  | hat only; left limbs mirrored |

Limits (`SkinLimits`, defaults `DEFAULT_SKIN_LIMITS`; an override must be an integer, `maxFileBytes` ≥ 1 and
`maxSide` ≥ 64, else a `RangeError`): `maxFileBytes` 2 MiB, `maxSide` 1024 pixels wide (HD skins up to 16 pixels per
skin pixel). The checks run in this order and before anything is copied: the name (at most `MAX_SKIN_NAME_CHARS`,
1024 characters), the file length, the PNG signature and IHDR header, the size rule. A
failure throws `SkinError` with a `code`; the message names the rule, never file content:

| code             | cause                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `FILE_TOO_LARGE` | more than `maxFileBytes`                                                   |
| `NOT_PNG`        | 1–7 bytes, no PNG signature, or the first chunk is not IHDR                |
| `TRUNCATED`      | empty, or the PNG signature followed by less than IHDR (8–32 bytes)        |
| `BAD_SIZE`       | not 64 · 2^k wide, wider than `maxSide`, not square or 2:1, or a zero size |
| `INVALID_NAME`   | `name` is not a string of at most 1024 characters                          |

A valid header over image data that does not decode passes `loadSkin` (a legacy skin then gets
`legacyHatOpaque: false`, keeping its hat); the renderer shows its placeholder for a texture that fails to decode, with
a warning. Skins come only from bytes the caller hands over: nothing is fetched,
and fetching a skin by user name is not offered (it would send the name to a third party).

## API

| export                                                                | package              | what                                       |
| --------------------------------------------------------------------- | -------------------- | ------------------------------------------ |
| `loadSkin`, `SkinLoadOptions`, `SkinLoadResult`, `SkinLayout`         | `@modelshot/formats` | skin bytes → texture, layout, hat rule     |
| `SkinError`, `SkinErrorCode`                                          | `@modelshot/formats` | the error `loadSkin` throws                |
| `SkinLimits`, `DEFAULT_SKIN_LIMITS`, `MAX_SKIN_NAME_CHARS`            | `@modelshot/formats` | limits (2 MiB, 1024 px wide, 1024 chars)   |
| `createPlayerModel`, `PlayerModelOptions`, `PlayerArms`               | `@modelshot/formats` | the player scene document                  |
| `PLAYER_OUTER_ALPHA_CUTOFF`                                           | `@modelshot/formats` | 0.1, the outer layer's alpha cutoff        |
| `PLAYER_BONES`, `PlayerBoneName`                                      | `@modelshot/scene`   | node names of the player rig               |
| `poseScene`, `PoseResult`, `ScenePose`, `ScenePoseBone`               | `@modelshot/scene`   | posing from rest                           |
| `MAX_POSE_BONES`, `MAX_POSE_ROTATION_DEG`, `MAX_POSE_TRANSLATION`     | `@modelshot/scene`   | pose limits (1024 bones, 360°, 4096 units) |
| `PLAYER_POSE_PRESETS`, `PlayerPosePresetName`, `playerPosePreset`     | `@modelshot/scene`   | built-in poses                             |
| `attachModel`, `AttachOptions`, `SceneAttachment`, `MAX_ATTACH_SCALE` | `@modelshot/scene`   | merging a model under a bone (scale ≤ 16)  |

## Model

`createPlayerModel(skin, { arms, showOuterLayer? })`: `arms` is `'classic'` (4-pixel arms) or `'slim'` (3-pixel
arms); `showOuterLayer: false` hides the outer-layer meshes (they stay in the document). `skin.legacyHatOpaque`
`true` on a legacy skin leaves the `hat` mesh out of the document; the field is ignored for a modern skin, absent means
`false`, and any other value than a boolean throws a `RangeError`. Units are skin pixels
(1/16 block, the scene format's unit), y up, the player facing −Z (north) with its right side at +X, feet at y = 0.
Seen from the front, the player's right arm is on the viewer's left.

| node / mesh           | box (before inflation)      | pivot          | skin offset (base, outer) |
| --------------------- | --------------------------- | -------------- | ------------------------- |
| `head` / `hat` (+0.5) | −4, 24, −4 .. 4, 32, 4      | 0, 24, 0       | 0, 0 ; 32, 0              |
| `body` / `jacket`     | −4, 12, −2 .. 4, 24, 2      | 0, 24, 0       | 16, 16 ; 16, 32           |
| `right_arm` classic   | 4, 12, −2 .. 8, 24, 2       | 5, 22, 0       | 40, 16 ; 40, 32           |
| `right_arm` slim      | 4, 11.5, −2 .. 7, 23.5, 2   | 5, 21.5, 0     | 40, 16 ; 40, 32           |
| `left_arm`            | the right arm mirrored in X | −5, (as right) | 32, 48 ; 48, 48           |
| `right_leg` / pants   | −0.1, 0, −2 .. 3.9, 12, 2   | 1.9, 12, 0     | 0, 16 ; 0, 32             |
| `left_leg` / pants    | −3.9, 0, −2 .. 0.1, 12, 2   | −1.9, 12, 0    | 16, 48 ; 0, 48            |

The outer layer (`hat`, `jacket`, `right_sleeve`, `left_sleeve`, `right_pants`, `left_pants`) is the base box
inflated by 0.5 (hat) or 0.25. Face UVs are Blockbench's box UV of the un-inflated size at the skin offset (front =
north at `[offset + z, offset + z]`), the same layout `.bbmodel` box-UV cubes use. The slim arm hangs half a pixel
lower than the classic one, as in Minecraft (`PartPose.offset(±5, 2.5, 0)`). A legacy skin draws `left_arm` and
`left_leg` from the right limbs' texels with box-UV mirroring (east and west swapped, every face flipped), as
Minecraft did before 1.8, and has only the hat as outer layer.

Nodes, parents first, all named after `PLAYER_BONES`: `head`, `body`, `right_arm`, `left_arm`, `right_leg`,
`left_leg` (roots, as in Minecraft, so the arms do not follow a turned body), and `right_hand`, `left_hand`: mesh-free
children of the arms whose pivot is the centre of the arm's bottom face (x ±6 classic, ±5.5 slim; y 12 classic,
11.5 slim). An attached model hangs from that point.

### Transparency

- Material 0 `skin`: `alphaMode: 'opaque'`, single-sided. The base layer is drawn whatever its texel alpha (a skin
  with alpha 0 in the face shows the texel's RGB, as Minecraft does).
- Material 1 `skin outer layer`: `alphaMode: 'blend'`, `alphaCutoff: 0.1`, double-sided. Texels below alpha 0.1 are
  holes for camera, shadow and ambient-occlusion rays; the others blend order-independently; the inside of a sleeve is
  visible through its holes.

Overlapping coplanar faces never depend on draw order: the legs overlap by 0.2 (`left_leg` has render order 1); the
outer boxes touch along strips, so the jacket has order 0, the sleeves 1, the right pants 2 and the left pants 3, and
the scene format's tie rule decides ([scene-format.md](scene-format.md)).

### Legacy hat

Old 64 × 32 skins often filled the hat area with an opaque colour. Minecraft clears that area when it has no
transparent texel (`doNotchTransparencyHack`), and so does ModelShot: `loadSkin` sets `legacyHatOpaque` when every
texel in x 32..64, y 0..32 of the 64 × 32 UV space (scaled for HD skins: x 32s..64s, y 0..32s with s = width / 64) has
alpha ≥ 128 (16-bit alpha: its high byte), and `createPlayerModel` then builds no `hat` mesh at all, whatever
`showOuterLayer` says. One texel below alpha 128 anywhere in that area keeps the hat as the usual cut-out blend layer.
A legacy skin whose pixel data does not decode keeps its hat, and so does one larger than 1024 × 512 (only possible
with a raised `limits.maxSide`; its pixels are not decoded). Modern 64 × 64 skins always keep theirs.

## Poses

`poseScene(doc, pose)` applies a `ScenePose` to the rest pose (rules in [scene-format.md](scene-format.md#poses)).
`PLAYER_POSE_PRESETS` are data (degrees, X first, then Y, then Z; positive X swings a limb forward):

| preset | bones                                                                     |
| ------ | ------------------------------------------------------------------------- |
| `idle` | none (rest)                                                               |
| `walk` | `right_arm` 30, `left_arm` −30, `right_leg` −30, `left_leg` 30 (about X)  |
| `hold` | `head` −10 (looks down), `right_arm` 40 (about X): the right hand forward |
| `wave` | `right_arm` 5 and `left_arm` −150 about Z: the left hand above the head   |

`playerPosePreset(name)` returns a preset by own key (so `constructor` gives `undefined`).

## Attaching a model

`attachModel(player, item, { bone: 'right_hand', offset?, rotation?, scale? })` merges `item` (any scene document,
for example a loaded `.bbmodel`) under the hand: the item's origin goes to the hand anchor, then `scale`, `offset` and
`rotation` (about the anchor) place it. It follows every later pose of the player
([scene-format.md](scene-format.md#attachments)). Attaching to a bone of an attached model works the same way.
