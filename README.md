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
pnpm -r build
pnpm test
```

Also: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (`pnpm format` fixes formatting).

Packages (`packages/*`): `formats`, `scene`, `renderer-rt`, `pathtracer`, `looks`, `export`, `app`, `embed`.

Docs: [scene format](docs/scene-format.md) (what every loader produces), [Blockbench loader](docs/bbmodel.md)
(supported features, limits, error codes).
