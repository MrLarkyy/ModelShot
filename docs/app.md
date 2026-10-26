# App

`packages/app` (`@modelshot/app`) is the editor served at `/app/`: it opens a model, shows it in the realtime
preview, renders it with the path tracer and exports an image or clip. Everything runs in the browser; nothing is
uploaded ([privacy](#privacy)).

## Flow

1. Files arrive by drop on the page, the Open button (Ctrl/Cmd+O) or the landing page's handoff ([site.md](site.md)).
2. `intake/checkIntake.ts` applies the handoff limits to every path. `intake/groupFiles.ts` turns the files into one
   load request: one model (`.bbmodel .gltf .glb .obj`) with its resources (`.bin .png .mtl`), or a lone `.png`, which
   is a player skin on the player model. Several models are refused.
3. A module worker (`intake/loadWorker.ts`) detects the format and parses the bytes with the `formats` loaders; the
   page never parses a model. A 30 s watchdog terminates a worker that does not answer. The previous scene stays on
   any failure.
4. The viewer draws the scene with `RealtimeRenderer`, orbit controls ([camera.md](camera.md)) and the baked lighting
   of the chosen look, re-baked when the scene, look or visibility changes.
5. Render runs the path tracer on the main thread (seed 1; samples, supersampling and denoise from the Render
   panel), with a progress element: one `step(4)` per animation frame while a denoised request draws its guide, else
   slices of about 8 ms; Esc cancels. The result canvas is hidden from the Render click until the first sample, and
   stays hidden after a cancel or a failure; a finished render stays until the camera or scene changes.
6. Export opens a dialog: still PNG (transparent), turntable or animation (only for a model with animations) as GIF,
   APNG or the other clip formats of [export.md](export.md). Options are checked with `checkExportOptions`; a
   failure names the field. The file is a download of a Blob URL, revoked afterwards.

The path tracer and the export code are loaded on first use and share one tracer (one context, one BVH).

The embed reuses the viewer and the intake: `@modelshot/app/viewer` (`Viewer`) and `@modelshot/app/intake`
(`checkIntake`, `groupFiles`, `loadModel`, `IntakeError`) are package exports for it ([embed.md](embed.md)).
`loadModel` takes an optional `AbortSignal`: on abort it kills the read worker and rejects with an `AbortError` (the
embed aborts a read its latest parameters no longer ask for); the app passes none.

## Files and limits

At most 32 files, 256 MiB in total, extensions `.bbmodel .gltf .glb .bin .obj .mtl .png`. Error codes, shown in a
`role="alert"` element within 5 s: `EMPTY`, `TOO_MANY`, `TOO_LARGE`, `UNSUPPORTED_TYPE` (limits), `MULTIPLE_MODELS`,
`NO_MODEL`, `LOAD_TIMEOUT` (30 s), `LOAD_FAILED` (worker crash), and the code of the loader that refused the file (its
own limits: elements, triangles, texture size, nesting). A model never triggers a request; external glTF URIs and OBJ
`mtllib` resolve only against the files chosen.

## Panels

- Camera: field of view (disabled in orthographic), perspective or orthographic, Frame, Reset, presets front (yaw 180,
  pitch 0), side (270, 0), three-quarter (210, 20, the default) and isometric.
- Scene: the node tree with a visibility checkbox per node; for the player model, classic or slim arms.
- Look: one radio per look preset ([look-presets.md](look-presets.md)). `session/applyLook.ts` is the one place that
  sets the look and edges on the viewer, the tracer and the bake.
- Render: samples, supersampling, denoise.

## Shortcuts

Ignored while typing in a field or with a dialog open; they never use the orbit keys (arrows, + - = _ 0 Home O I).

| Key        | Action                           |
| ---------- | -------------------------------- |
| Ctrl/Cmd+O | open files                       |
| R          | render                           |
| Ctrl/Cmd+E | export                           |
| Esc        | cancel the render, close dialogs |
| 1, 2, 3, 4 | front, side, three-quarter, iso  |
| L          | next look                        |
| H          | show or hide the selected node   |
| ?          | the shortcut list                |

## Local state v1

IndexedDB `modelshot-app`, version 1, on this device only:

- store `session`, key `current`: `{ v: 1, files, modelKey, savedAt }`, the files of the last open model, reopened on
  a start without handoff;
- store `models`, key = SHA-256 hex of the model bytes: `{ v: 1, camera, look, hiddenNodes, hiddenMeshes, arms?, render, export?, savedAt }`,
  restored when the same model is opened again. At most 20 entries; the oldest is evicted.

Saves are debounced by 500 ms. Reads are validated as untrusted (`state/readAppState.ts`: own properties, `v === 1`,
finite values in range, a known look, real `File` objects) and never throw; an invalid record is ignored. A full disk
or a failing database shows a non-blocking notice and the app goes on. "Forget local data" deletes the database. New
fields are optional; a breaking change bumps the version and ships a migration or discards the old record.

## Offline

A production build emits `sw.js` (scope `/app/`, same origin) listing every file of the build with a version hash.
Install caches them; activate deletes older caches; same-origin GET requests are answered cache-first with the network
as fallback; other origins and methods are untouched. A new version waits until the open tabs are closed, because they
hold the old file names. After one visit the whole flow, including export, works offline. A Content Security Policy
needs `worker-src 'self'`.

## Privacy

No request carries a body or leaves the origin; no analytics, fonts or scripts from elsewhere. Models, skins and state
stay in the browser (`test/localFirst.test.ts`, `e2e/app.network.spec.ts`).

## Accessibility

Landmarks (header, toolbar, panels, viewport), every control labelled, visible focus, errors in `role="alert"`,
progress in `role="status"`, native controls and dialogs, colours only from the brand tokens ([brand.md](brand.md)).

## Tests

Vitest in `packages/app/test`; Playwright in `packages/app/e2e` (`pnpm --filter @modelshot/app run test:browser`):
flow, formats, camera, persistence, hostile files, offline, network, handoff, accessibility and preview/render parity.
Bundle budgets: [testing.md](testing.md#budgets).
