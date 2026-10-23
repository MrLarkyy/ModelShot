# Landing page

`packages/site` (`@modelshot/site`) is the static landing page: one `index.html`, CSS files that use the brand tokens
only ([brand.md](brand.md)) and a small script for the file picker and the drop zone. From the app it imports only
the handoff module `@modelshot/app/handoff` (limits, checks, storage), which it bundles; it hands files to the app and
never parses them.

## Layout

| path                          | what                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `index.html`                  | sections `top` (hero, drop zone), `highlights`, `looks`, `how`, `faq`, `open` (CTA), footer `footer`       |
| `src/main.ts`                 | loads the brand CSS and the page CSS, wires the drop zone, starts the load-time cleanup                    |
| `src/cleanUpHandoff.ts`       | load-time cleanup: discards a stale record, only when `indexedDB.databases()` lists `modelshot-handoff`    |
| `src/dropZone.ts`             | picker buttons, drop zone, page-wide drop guard, handoff to the app                                        |
| `src/styles/`                 | `base.css` (ground, type, focus), `layout.css`, `components.css`, `motion.css`                             |
| `src/build/inlineBrandSvg.ts` | Vite plugin: replaces `<!-- brand:mark -->` and `<!-- brand:hero-island -->` with the committed brand SVGs |
| `e2e/`                        | Playwright specs and the guard fixture `siteTest.ts`                                                       |
| `goldens/`                    | `landing-360.png`, `landing-768.png`, `landing-1440.png`                                                   |

`pnpm --filter @modelshot/site build` writes `dist/`; `build:with-app` also builds the app with base `/app/` into
`dist/app/`, the layout the page expects when hosted.

The looks tiles and the hero island are illustrations, labelled as such ("ILLUSTRATION · NOT A RENDER"), until the
path tracer produces sample renders. The embed tile says the snippet arrives with the embed API.

## Hosting contract (for MS-26)

- The landing page is served at `/` and the app at `/app/` of the same origin. The handoff below depends on it:
  IndexedDB is per origin.
- The page makes no request to another origin: fonts, icons and the social preview come from the site itself. The
  only off-origin references are links to the GitHub repository.
- `og:image` is relative (`/social-preview.png`) until the domain is known.

## File handoff to the app

The drop zone and the "Open a model" buttons never upload anything. The landing page stores the chosen files in the
browser and opens the app, which takes them:

1. The site checks the selection with `checkHandoffFiles` (`@modelshot/app/handoff`): at most 32 files, at most
   256 MiB in total, extensions `.bbmodel .gltf .glb .bin .obj .mtl .png` (any case). A failure is shown in the
   `role="alert"` element under the drop zone with a message naming the limit (`EMPTY`, `TOO_MANY`,
   `UNSUPPORTED_TYPE`, `TOO_LARGE`), and the page stays.
2. `putHandoffFiles` empties IndexedDB database `modelshot-handoff`, store `pending`, and writes one record under
   key `current`: `{ v: 1, files: File[], createdAt: <ms since epoch> }`, in one transaction. A write that does not
   finish within its timeout is aborted and reported in the alert, so no copy is stored after the page gave up. The
   write timeout grows with the bytes (`putTimeoutMs`: 5 s plus 1 s per 16 MiB, 21 s at the 256 MiB limit); a
   handoff at the limit measured 45..274 ms to store and 174..433 ms to take (Chromium, Windows and Ubuntu).
3. The site navigates to `./app/?open=handoff`.

   On every landing page load, before any of this, `src/cleanUpHandoff.ts` asks `indexedDB.databases()`; only when
   it lists `modelshot-handoff` does it open the database and call `discardStaleHandoff` (details below).

4. The app (`packages/app/src/App.ts`, on `?open=handoff`) calls `takeHandoffFiles`, which reads and deletes the record in
   one transaction, then validates it as untrusted (`readHandoffRecord`): own data properties only, `v === 1`, a finite
   `createdAt` at most 60 s in the future (clock skew between tabs), real `File` objects only, the same limits
   again. A record older than 10 minutes is discarded. The validation never throws; its result is `files`, `none`,
   `expired` or `invalid` with a reason code. `takeHandoffFiles` itself rejects when IndexedDB is missing, fails
   or does not answer within 5 s; the app then shows that error in its `role="alert"` element.
5. The app opens the files like a drop ([app.md](app.md)) and removes `?open=handoff` from the address with
   `history.replaceState`, so a reload reopens the app's own session instead of looking for a record that is gone.
   A missing, expired or invalid record is reported in the `role="status"` element (`describeHandoff`).

Every IndexedDB step gives up after its timeout (5 s; a write at the limit 21 s) with an error naming the step (the
transaction is aborted), so a stuck database never hangs either page. On load the landing page deletes a record the
app can no longer take (expired or unreadable, `discardStaleHandoff`), so files that were never opened do not stay on
disk; a fresh record is kept. It looks first with `indexedDB.databases()` and opens the database only if it exists,
so a visitor who never handed a file over gets none; browsers without `databases()` skip the cleanup. The picker is
emptied after every attempt and when the page is shown again from the back/forward cache, so the same file can be
chosen again. A file dropped anywhere else on the landing page is ignored rather than opened by the browser.

## Motion

CSS only (`src/styles/motion.css`), and only `transform` and `opacity` move, so nothing reflows:

| motion       | where                        | loop                                                                       |
| ------------ | ---------------------------- | -------------------------------------------------------------------------- |
| float        | hero island                  | 6 s, up 10 px                                                              |
| glow pulse   | island glow, lights swatches | 2.6 s, opacity and scale                                                   |
| render sweep | hero tile                    | 5 s, a light band under the tile's text; at rest it waits outside the tile |
| hover lift   | highlight tiles              | 200 ms, up 4 px; the shadow is a layer that fades in                       |
| looks cycle  | looks tiles                  | 8 s, a ring fades in on each tile in turn (0/2/4/6 s)                      |

With `prefers-reduced-motion: reduce` every animation and transition is off. The six fonts are preloaded and use
`font-display: block`, so the page has no layout shift while loading.

## Tests

- Vitest (`test/`): no raw colours (hex, colour functions, CSS named colours) or inline styles, no off-origin
  reference in the sources, every coloured CSS rule is a checked contrast pair, the SVG inlining plugin, the load-time
  cleanup (`cleanUpHandoff.test.ts`: no open without the database or without `databases()`, open when it exists).
- Playwright (`e2e/`, own config, not the harness): every request must be a GET on the site origin and no page error
  may occur (`siteTest.ts`).
  - `landing.golden.spec.ts`: full-page goldens at 360, 768 and 1440 px, animations stopped, fonts loaded;
    `maxDiffPixelRatio` 0.002 (about 5x the measured Windows vs Ubuntu difference of at most 0.00042),
    `threshold` 0.2.
  - `landing.layout.spec.ts`: no horizontal scroll at the three widths, section order, Tab reaches every control with
    a 3 px ring in the right colour, the picker buttons.
  - `landing.a11y.spec.ts`: axe (WCAG 2.x A/AA) at 360 and 1440 px, with all answers open, with the sweep held over
    the hero text; every rendered text/ground pair is a checked contrast pair.
  - `landing.network.spec.ts`: same-origin requests only, fonts served by the site.
  - `landing.motion.spec.ts`: running animations move only transform/opacity, hover transitions too, cumulative
    layout shift 0 over load and 4 s at 360 and 1440 px, nothing runs with reduced motion and the sweep band then rests
    outside the hero tile.
  - `landing.handoff.spec.ts`: picker and drop open the files in the app and the record is gone; `.exe` and 33 files
    are refused with an alert; a drop outside the zone does nothing; the app refuses expired and unknown records; the
    picker is empty after a refused choice, after a storage failure, after Back from the app and after a
    back/forward-cache restore; the landing page removes an expired record on load and keeps a fresh one; a first
    visit creates no handoff database; 32 files of 256 MiB are stored and opened in under half of each timeout.

`pnpm test` runs them after the harness (`pnpm test:browser`); the port is `MS_SITE_PORT`, else a stable per-checkout
port derived from the site directory. CI uploads `packages/site/test-results/` with the harness results.

Goldens change only deliberately: `pnpm golden:update:site` (rewrites all three; refused when `CI` is set), then
review the images beside the landing page canvas at the same widths before committing.
