# App

`packages/app` (`@modelshot/app`) is the editor served at `/app/`: it opens a model, shows it in the realtime
preview, renders it with the path tracer and exports an image or clip. Everything runs in the browser; nothing is
uploaded ([privacy](#privacy)).

## Flow

1. Files arrive by drop on the page, the Open button (Ctrl/Cmd+O) or the landing page's handoff ([site.md](site.md)).
2. `intake/checkIntake.ts` applies the handoff limits to every path. `intake/groupFiles.ts` turns the files into one
   load request: one model (`.bbmodel .gltf .glb .obj`) with its resources (`.bin .png .jpg .jpeg .mtl`), or a lone
   `.png`, which is a player skin on the player model (a lone `.jpg` is `NO_MODEL`: skins are PNG). Several models are
   refused.
3. A module worker (`intake/loadWorker.ts`) detects the format and parses the bytes with the `formats` loaders; the
   page never parses a model. A 30 s watchdog terminates a worker that does not answer. The previous scene stays on
   any failure.
4. The viewer draws the scene with `RealtimeRenderer`, orbit controls ([camera.md](camera.md)) and the baked lighting
   of the chosen look, re-baked when the scene, look or visibility changes.
5. Render runs the path tracer on the main thread (seed 1; samples, supersampling and denoise from the Render
   tab), with a progress element: one `step(4)` per animation frame while a denoised request draws its guide, else
   slices of about 8 ms; Esc cancels. The result canvas is hidden from the Render click until the first sample, and
   stays hidden after a cancel or a failure; a finished render stays until the camera or scene changes.
6. Export opens a dialog: still PNG (transparent), turntable or animation (only for a model with animations) as GIF,
   APNG or the other clip formats of [export.md](export.md). Options are checked with `checkExportOptions`; a
   failure names the field. The file is a download of a Blob URL, revoked afterwards.

The path tracer and the export code are loaded on first use and share one tracer (one context, one BVH). The overlay,
picking, gizmo and timeline code (`editor/EditorTools.ts`) is a separate chunk loaded when the first model is shown,
so the empty app does not carry it.

The embed reuses the viewer and the intake: `@modelshot/app/viewer` (`Viewer`) and `@modelshot/app/intake`
(`checkIntake`, `groupFiles`, `loadModel`, `openModel`, `IntakeError`) are package exports for it
([embed.md](embed.md)). `loadModel` takes an optional `AbortSignal`: on abort it kills the read worker and rejects
with an `AbortError` (the embed aborts a read its latest parameters no longer ask for); the app passes none.
`openModel` (the same options) is a session on one worker: `listReferences` reads and parses the model once there
and lists the files it refers to (and a material library's), `load` loads the same `File` from what was parsed, and
the 30 s watchdog counts only the time spent waiting on the worker; `loadModel` is a session with only a load.
`Viewer` has two additive members the app uses and the embed ignores: `ViewerOptions.onFrame(camera)`, called after
every drawn frame with the camera that frame used, and `setPose(doc)`, another pose of the shown document on the
renderer's pose-only path (no decode, upload or bake).

## Files and limits

At most 32 files, 256 MiB in total, extensions `.bbmodel .gltf .glb .bin .obj .mtl .png .jpg .jpeg`. Error codes, shown
in a `role="alert"` element within 5 s: `EMPTY`, `TOO_MANY`, `TOO_LARGE`, `UNSUPPORTED_TYPE` (limits),
`MULTIPLE_MODELS`, `NO_MODEL`, `LOAD_TIMEOUT` (30 s), `LOAD_FAILED` (worker crash), and the code of the loader that
refused the file (its own limits: elements, triangles, texture size, nesting). A model never triggers a request;
external glTF URIs and OBJ `mtllib` resolve only against the files chosen.

## Editor layout

The page is a dark Ink workspace (colours from the brand tokens only): a top bar, the outliner on the left, the 3D view
in the middle, the inspector on the right and the timeline below.

- **Top bar**: the panel toggles (Outliner, Inspector, Timeline, each with `aria-expanded`), the File menu (Open,
  Export, "Forget local data", Shortcuts), Undo and Redo, the Preview / Render switch, Render, Share and Export.
  Preview shows the live view; the Render switch shows the finished render (it starts one when there is none). The File
  menu is a disclosure of buttons, not an ARIA menu: Tab moves through it and Esc closes it.
- **Resize and collapse**: the separators between the panels are focusable (`role="separator"` with
  `aria-valuenow`): drag them, or use the arrow keys (16 px), Home and End. Widths are clamped (outliner 180-480 px,
  inspector 260-520, timeline 96-320). A toggle collapses a panel. Sizes, collapsed panels, the overlay toggles and the
  inspector tab are kept in this browser (`localStorage` key `modelshot.layout.v1`, at most 2 KB, parsed defensively;
  an unreadable or blocked store means the defaults). "Forget local data" removes it too.
- **Below 1024 px** the outliner and the inspector are drawers over the view: the toggles open one at a time, Esc
  closes it and returns the focus to its toggle, and the timeline shrinks to one row. The view keeps the whole width.
- **Outliner**: the node tree (at most 500 rows are listed) with, per row, a visibility checkbox, a name button that
  selects and a Lock toggle (`aria-pressed`). F2 or a double click renames (128 characters, Enter keeps, Esc cancels;
  an empty name takes the file's name back). The search field keeps the rows whose label contains the text, with their
  groups, and says "N matches". The Lights group lists the look's key and rim light and opens the Light tab. The Add
  menu has "Open model" and a disabled "Add light" (user-placed lights are not available yet). Labels and locks are
  app labels: they never change the scene document, an export or a pixel.
- **Inspector** (tabs: arrows, Home and End move between them): **Object** (name, visible, locked, position and
  rotation of the selected node, the player's arms), **Material** (the materials the selected element draws with,
  alpha mode, blending, sides, and "Texture filtering" with a Nearest (pixel art, the default) or Linear (smooth)
  select per texture, applied to the preview and the render), **Light** (the look's key and rim light, read-only),
  **Look** (one radio per look preset, [look-presets.md](look-presets.md); `session/applyLook.ts` is the one place that
  sets the look and edges on the viewer, the tracer and the bake) and **Render** (samples, supersampling, denoise, and
  the camera: field of view (disabled in orthographic), perspective or orthographic, Frame, Reset).
- **The view**: clicking a mesh selects it (a press that moves more than 4 px orbits instead and selects nothing), a
  click on empty ground clears the selection, and locked or hidden meshes cannot be picked. The selected node shows a
  move (W) or rotate (E) gizmo: drag a handle to change the node's translation or rotation; the drag is shown live and
  a release is one undoable step, remembered with the model. The camera presets front (yaw 180, pitch 0), side
  (270, 0), three-quarter (210, 20, the default) and isometric are buttons over the view and keys 1-4.
- **Overlays**: the grid floor, the axis gizmo, statistics (fps, triangles, meshes, overlay time), the camera presets
  and the light and transform gizmos (the key light as an arrow) are drawn on a separate 2D canvas over the preview,
  projected with the camera the renderer just drew with. The "Overlays" menu (or G for all) switches each; none of
  them is in the preview's WebGL canvas, the render or an export (`test/overlayIsolation.test.ts`,
  `e2e/app.overlay.spec.ts`).
- **Timeline**: the clips of the model, Play / Pause (one button that renames itself), Loop, a scrubber (a labelled range: "1.25 s of 2.00 s") and a
  marker per distinct keyframe time of the clip, from the file. Nothing plays by itself. Frames use the renderer's
  pose-only path (no texture decode, upload or light bake per frame); the light is baked again for a pose that stays (about
  0.2 s after a pause, the end of a scrub or an edit), so the preview shows the shadows of what it shows; starting a render, opening Export or opening
  another model pauses playback, and playing or scrubbing during a render cancels it. A model without animations shows
  "This model has no animations".
- **Undo and Redo** (Ctrl/Cmd+Z, Ctrl+Shift+Z or Ctrl+Y) step through visibility, locks, names, texture filters, node
  edits and the look, at most 100 steps, cleared when another model opens.
- **Share** appears only where the browser can share files (`navigator.canShare`) and a render is shown: it hands the
  PNG of the render to the operating system's share sheet when clicked. Nothing is sent by the app.
- **Export** of a still or a turntable uses the pose the preview shows; an animation clip is built from the rest pose
  with the node edits applied on every sampled frame, so exporting with the playhead at 0.5 s equals exporting at 0.
- **Motion** (panel and tab fades, drawer slides) uses the brand motion tokens and only opacity and transform; with
  `prefers-reduced-motion: reduce` every transition and animation is off, live.

## Shortcuts

Ignored while typing in a field or with a dialog open; they never use the orbit keys (arrows, + - = \_ 0 Home O I). The
list in the app (`?`, grouped File, View, Selection, Timeline) is built from `SHORTCUTS` in
`shortcuts/shortcutAction.ts`.

| Key                      | Action                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| Ctrl/Cmd+O               | open files                                                           |
| Ctrl/Cmd+E               | export                                                               |
| Ctrl/Cmd+Z               | undo                                                                 |
| Ctrl/Cmd+Shift+Z, Ctrl+Y | redo                                                                 |
| R                        | render                                                               |
| Esc                      | cancel the render, close dialogs, menus and drawers                  |
| 1, 2, 3, 4               | front, side, three-quarter, iso                                      |
| L                        | next look                                                            |
| G                        | all overlays off, or back on                                         |
| [ and ]                  | outliner and inspector                                               |
| T                        | timeline                                                             |
| ?                        | the shortcut list                                                    |
| H                        | show or hide the selected node                                       |
| W and E                  | move and rotate gizmo                                                |
| F2                       | rename the selected node                                             |
| Space                    | play or pause (a focused button, link, tab or separator keeps Space) |

## Local state v1

IndexedDB `modelshot-app`, version 1, on this device only:

- store `session`, key `current`: `{ v: 1, files, modelKey, savedAt }`, the files of the last open model, reopened on
  a start without handoff;
- store `models`, key = SHA-256 hex of the model bytes: `{ v: 1, camera, look, hiddenNodes, hiddenMeshes, textureFilters?, arms?, names?, lockedNodes?, lockedMeshes?, nodeEdits?, render, export?, savedAt }`,
  restored when the same model is opened again. At most 20 entries; the oldest is evicted. `names` maps
  `n:<node index>` / `m:<mesh index>` to a label of at most 128 characters, the locks are index lists and `nodeEdits`
  is `{ node, translation, rotation }[]` (finite, at most `MAX_ANIMATION_VALUE`). A record from before the editor lacks
  them and reads as before; a bad entry is dropped on its own.

The panel layout is not in this database: it is `localStorage` `modelshot.layout.v1`
([Editor layout](#editor-layout)).

Saves are debounced by 500 ms. Reads are validated as untrusted (`state/readAppState.ts`: own properties, `v === 1`,
finite values in range, a known look, real `File` objects) and never throw; an invalid record is ignored. A full disk
or a failing database shows a non-blocking notice and the app goes on. "Forget local data" deletes the database and
the stored layout. New fields are optional; a breaking change bumps the version and ships a migration or discards the
old record.

## Offline

A production build emits `sw.js` (scope `<site>/app/`, same origin; the landing page and the embed frame are not
controlled) listing every file of the build with a version hash.
Install caches them; activate deletes older caches; same-origin GET requests are answered cache-first with the network
as fallback; other origins and methods are untouched. A new version waits until the open tabs are closed, because they
hold the old file names. After one visit the whole flow, including export, works offline. `index.html` carries the
Content Security Policy (`default-src 'self'`, `worker-src 'self'`, no inline code) right after the charset meta; see
[hosting.md](hosting.md).

## Privacy

No request carries a body or leaves the origin; no analytics, fonts or scripts from elsewhere. Models, skins and state
stay in the browser (`test/localFirst.test.ts`, `e2e/app.network.spec.ts`). Share hands a PNG to the operating system's
share sheet on a click; the app makes no request for it.

## Accessibility

Landmarks (header, outliner `nav`, view `main`, inspector `aside`, timeline `section`, a focusable messages region),
every control labelled, visible focus (the yellow `--ms-focus-on-dark` ring on the dark workspace), errors in
`role="alert"`, progress in `role="status"`, native controls and dialogs, tabs and separators with their ARIA patterns,
the overlay canvas `aria-hidden`, colours only from the brand tokens ([brand.md](brand.md)). Every panel is reachable by
keyboard; the shortcut list is the cheat sheet.

## Tests

Vitest in `packages/app/test`; Playwright in `packages/app/e2e` (`pnpm --filter @modelshot/app run test:browser`):
flow, formats, camera, persistence, hostile files, offline, network, handoff, accessibility and preview/render parity,
and the editor: `app.editor.spec.ts` (outliner, picking, gizmo, undo, names and locks), `app.timeline.spec.ts`,
`app.layout.spec.ts` (1280, 1440, 1920 and 900 px with screenshots in `test-results` for review, resize, collapse,
drawers), `app.overlay.spec.ts` (toggles; overlays never in the preview, render or export) and `app.motion.spec.ts`
(reduced motion, overlay draw time). Bundle budgets: [testing.md](testing.md#budgets).
