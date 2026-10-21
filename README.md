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

`pnpm browsers` installs the pinned headless Chromium used by the browser tests once; see [docs/testing.md](docs/testing.md).

Also: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (`pnpm format` fixes formatting).

Packages (`packages/*`): `formats`, `scene`, `renderer-rt`, `pathtracer`, `looks`, `export`, `app`, `embed`, `brand`
(design tokens, fonts, logo) and `site` (the landing page). Test tooling lives in `tools/harness`.

Docs: [scene format](docs/scene-format.md) (what every loader produces), [Blockbench loader](docs/bbmodel.md),
[glTF / GLB loader](docs/gltf.md) and [OBJ loader](docs/obj.md) (supported features, limits, error codes),
[realtime renderer](docs/realtime-renderer.md) (passes, pixel-art sampling, transparency, context loss),
[path tracer](docs/path-tracer.md) (API, determinism, alpha, sides and order on every ray, lighting),
[camera](docs/camera.md) (the shared camera, frame-to-fit, controls),
[brand](docs/brand.md) (tokens, contrast rules, fonts, logo and icons, licences),
[landing page](docs/site.md) (layout, hosting at `/` and `/app/`, the local file handoff, motion, tests).
