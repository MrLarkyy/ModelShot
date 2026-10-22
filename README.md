<img src="packages/brand/assets/logo/mark.svg" width="64" height="64" alt="ModelShot logo">

# ModelShot

**Studio-quality renders of Blockbench and low-poly models, right in your browser.**

Open a model, pick a look, press Render. ModelShot keeps pixel-art textures crisp, handles transparent pixels, rounds
edges softly and path-traces global illumination — all on your own GPU, nothing uploaded. Export images, turntables and
animations, or embed a live viewer on your page.

Status: early development.

## Development

Requires Node 22 LTS (see `.nvmrc`) and pnpm, pinned through corepack:

```sh
npm i -g corepack@latest
corepack enable
pnpm install
pnpm browsers
pnpm -r build
pnpm test
```

`pnpm browsers` installs the pinned headless Chromium used by the browser tests once; see [Testing](https://github.com/MrLarkyy/ModelShot/wiki/Testing).

Also: `pnpm typecheck` (`tsc -b` over the root `tsconfig.json`, which references every package, `tools/harness` and
`tsconfig.config.json` for the root config files; a new package adds its reference there), `pnpm lint`, `pnpm format:check` (`pnpm format` fixes formatting).

Packages (`packages/*`): `formats`, `scene`, `renderer-rt`, `pathtracer`, `looks`, `export`, `app`, `embed`, `brand`
(design tokens, fonts, logo) and `site` (the landing page). Test tooling lives in `tools/harness`; the wiki build in `tools/wiki`.

Docs: [scene format](https://github.com/MrLarkyy/ModelShot/wiki/Scene-format) (what every loader produces), [Blockbench loader](https://github.com/MrLarkyy/ModelShot/wiki/Blockbench-loader),
[glTF / GLB loader](https://github.com/MrLarkyy/ModelShot/wiki/glTF-loader) and [OBJ loader](https://github.com/MrLarkyy/ModelShot/wiki/OBJ-loader) (supported features, limits, error codes),
[player skins and posing](https://github.com/MrLarkyy/ModelShot/wiki/Player-skins-and-posing) (the player model from a skin, poses, held models),
[realtime renderer](https://github.com/MrLarkyy/ModelShot/wiki/Realtime-renderer) (passes, pixel-art sampling, transparency, context loss),
[path tracer](https://github.com/MrLarkyy/ModelShot/wiki/Path-tracer) (API, determinism, alpha, sides and order on every ray, lighting),
[look presets](https://github.com/MrLarkyy/ModelShot/wiki/Look-presets) (the shared look parameters both renderers read),
[camera](https://github.com/MrLarkyy/ModelShot/wiki/Camera) (the shared camera, frame-to-fit, controls),
[export](https://github.com/MrLarkyy/ModelShot/wiki/Export) (PNG, APNG, GIF, WebP, WebM and MP4 from the path tracer: options, limits, fallback),
[brand](https://github.com/MrLarkyy/ModelShot/wiki/Brand) (tokens, contrast rules, fonts, logo and icons, licences),
[landing page](https://github.com/MrLarkyy/ModelShot/wiki/Landing-page) (layout, hosting at `/` and `/app/`, the local file handoff, motion, tests),
[testing](https://github.com/MrLarkyy/ModelShot/wiki/Testing) (unit and browser layers, goldens, budgets, CI).

The [wiki](https://github.com/MrLarkyy/ModelShot/wiki) is generated from `docs/` on every push to `main` (`tools/wiki`); edit the pages there.
