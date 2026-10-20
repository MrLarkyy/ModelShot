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

Packages (`packages/*`): `formats`, `scene`, `renderer-rt`, `pathtracer`, `looks`, `export`, `app`, `embed`. Test tooling lives in `tools/harness`.
