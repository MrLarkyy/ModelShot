# App

`packages/app` (`@modelshot/app`) is the editor served at `/app/`: it opens a model, shows it in the realtime
preview, renders it with the path tracer and exports an image or clip. Everything runs in the browser; nothing is
uploaded ([privacy](#privacy)).

## Flow

1. Files arrive by drop on the page, the Open button (Ctrl/Cmd+O) or the landing page's handoff ([site.md](site.md)). With
   no model open the stage is the empty state: a card that says what to open (Blockbench, glTF/GLB and OBJ models with
   their textures, player skins), that the file stays in the tab and is never uploaded, a primary Open… with its
   shortcut, and three entry cards (Blockbench model, Player skin, glTF or OBJ) that open the picker narrowed to their
   kind. A drag of files over the page highlights the card (a dashed blue border); with a model open the full "Drop to
   open" overlay shows instead. A drop takes the same path as the picker: the dialog and export guard, `checkIntake`,
   the same limits and errors. After the first model opens, a one-time row names the keys worth knowing; its close
   button dismisses it for good.
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
   tab); the render bar floats at the bottom of the view and swaps "Render · N samples" for a progress element, the
   text "128 / 256 samples · 50 % · 0:12" (samples, percent, elapsed; the elapsed time ticks every second) and Stop.
   It takes one `step(4)` per animation frame while a denoised request draws its guide, else slices of about 8 ms;
   Esc or Stop cancels. The result canvas is hidden from the Render click until the first sample, and stays hidden
   after a cancel or a failure; a finished render stays until the camera or scene changes, with its output size,
   samples and time ("1920 × 1080 px · 256 samples · 0:24") in the bar. Messages are toasts over the view (see Editor
   layout): nothing a render shows resizes the view, which would cancel it.
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

At most 32 files, 256 MiB in total, extensions `.bbmodel .gltf .glb .bin .obj .mtl .png .jpg .jpeg`. The picker's `accept`
is that list (`intake/pickerAccept.ts`, a test pins `#file-input` to it); an entry card narrows it to its kind (a skin
to `.png`), and every opener sets it before the click, so a cancelled narrow pick never leaks into the next Open. Error codes, shown
in a `role="alert"` element within 5 s: `EMPTY`, `TOO_MANY`, `TOO_LARGE`, `UNSUPPORTED_TYPE` (limits),
`MULTIPLE_MODELS`, `NO_MODEL`, `LOAD_TIMEOUT` (30 s), `LOAD_FAILED` (worker crash), and the code of the loader that
refused the file (its own limits: elements, triangles, texture size, nesting). A model never triggers a request;
external glTF URIs and OBJ `mtllib` resolve only against the files chosen.

## Editor layout

The page is a dark Ink workspace (colours from the brand tokens only): a top bar, the outliner on the left, the 3D view
in the middle, the inspector on the right and the timeline below.

- **Top bar**: one row at every width. In order: the logo, the File menu, Undo and Redo (icon buttons), the panel
  toggles (Outliner, Inspector, Timeline: icon buttons with `aria-expanded`), the Preview / Path traced switch, the
  model name with a status dot, Share (secondary; where the browser can share files it keeps its place and only
  disappears, so Export never moves) and Export, the only primary of the bar. There is no Render label in the bar.
  Preview shows the live view; Path traced shows the finished render (it starts one when there is none). Below 900 px
  the history, panel and mode groups sit behind a More button (`aria-expanded`; it follows the File menu in the page
  order so Tab reaches it before its list, opening moves the focus to the first control, the list stays open while its
  controls are used, and Esc closes it and returns the focus to More); the model name is cut
  with an ellipsis. The File menu is a disclosure of buttons, not an ARIA menu: Tab moves through it and Esc closes
  it. Rows: Open… (Ctrl+O), Export… (Ctrl+E), Shortcuts (?), a separator, then "Forget local data" (the destructive
  class); the shortcut hints are keycaps hidden from assistive technology (`aria-keyshortcuts` is on the Open… and
  Export… rows and on the empty card's Open…, with the Control and Meta forms), and the privacy note is a footer paragraph that Tab skips.
- **Empty state**: the card sits on the stage over a token gradient (the stage is `#viewport[data-empty]`; the preview
  canvas keeps its box but is not shown, so the render size stays valid and the realtime backdrop and the render are
  untouched). The chips and the stats are hidden while empty. The Outliner, Inspector and Timeline each say what opens
  them. The timeline is a one-row bar without its separator when no model is open or the model has no animation
  (`#timeline[data-empty]`), and the full panel for one with clips. The bar is one control row high with or without
  its Play button, so the view keeps its size when a model without clips opens: a resize after the model is shown
  would stop a render and move a restored camera off its saved framing. For a model with clips the panel takes its
  full size as the model is shown (not when the editor tools list the clips), and the viewer takes the view's new size
  at once (`Viewer.syncSize`) before the camera is framed or restored, so a reload brings back the saved view in a
  portrait view too.
- **First-run row**: `#first-run-hint` (a region "Shortcut hints") over the view, below the chips: keys from
  `SHORTCUTS`, drag to orbit and scroll to zoom. Dismissing it moves the focus to the 3D view.
- **Model dot**: next to the model name, `#model-state` is a dot with a shape per state, not colour alone (filled
  circle lit, dashed ring lighting, filled square unbaked) and a tooltip, driven by the viewer's `onBakeStarted` and
  `onBakeSettled`; its text, such as "Preview lit.", is kept for assistive technology (`aria-live="polite"`, not a status role).
  When the light cannot be baked for a reason (the path tracer did not load, the bake failed), the dot's text and
  tooltip name it, "The preview shows unbaked light: <reason>", and the same line is shown once as a toast (again only for a different reason or after the preview was lit). In forced
  colours the ring is `CanvasText` in every state.
- **Render bar**: floats at the bottom centre of the view, the last row of the view's bottom column
  (`.viewport-dock`): Render (primary) with the sample count from the Render tab
  while idle; progress, the numbers and Stop while running (the focus moves from Render to Stop and back); the result line after a render. It is shown and disabled
  with no model open.
- **Toasts**: `#status` (`role="status"`, always present) holds exactly the latest message, one at a time, and fades
  after 5 s while keeping its text. The messages sit above the render bar, in one column with it and the empty card
  (`.viewport-dock`): a message takes its own room there, so it covers neither the camera presets and Overlays at the
  top of the view, the first-run row, the render bar nor the card, from 375 to 1440 px. The column lies over the view
  and the drawers and never takes height from the view; the messages take at most half of its height and scroll
  beyond that (a shown message takes the pointer, so the wheel or a touch over it scrolls the messages and not the
  camera; once faded it lets the pointer through to the view), and without a message the status line takes no room. An error goes to `#alert` (`role="alert"`, with a Dismiss button) and stays until it is
  dismissed, which gives the focus to the File button, or until the next open, arms change or render clears it. A
  graphics-driver failure (`ViewerOptions.onError`) is pinned: it survives those and goes only when dismissed. A saving failure is not an error and not a status: it shows in its own chip (`#storage-chip`, a polite live region that is always in the tree and collapses when empty) under the status line, with a Dismiss button, until dismissed or the page reloads, and the app goes on. The graphics-context message is a status, sent by `ViewerOptions.onContextRestored`.
- **Resize and collapse**: the separators between the panels are focusable (`role="separator"` with
  `aria-valuenow`): drag them, or use the arrow keys (16 px), Home and End. Widths are clamped (outliner 180-480 px,
  inspector 260-520, timeline 96-320). A toggle collapses a panel. Sizes, collapsed panels, the overlay toggles and the
  inspector tab are kept in this browser (`localStorage` key `modelshot.layout.v1`, at most 2 KB, parsed defensively;
  an unreadable or blocked store means the defaults). "Forget local data" removes it too.
- **Below 1024 px** the outliner and the inspector are drawers over the view (a toast stays above them):
  the toggles open one at a time, Esc closes it and returns the focus to its toggle, and the timeline shrinks to one
  row without the keyframe markers. The view keeps the whole width.
- **Outliner**: a tree (`role="tree"`, rows `treeitem` with `aria-level`, `aria-expanded` and `aria-selected`; the model
  is `panels/outlinerTree.ts`, a pure flat list of the visible rows). Each row has a chevron for groups, a folder or cube
  icon, the name (select; F2 or a double click renames: 128 characters, Enter keeps, Esc cancels, an empty name takes
  the file's name back), an eye button "Hide <name>" and a lock button "Lock <name>", both `aria-pressed` with their
  icon changing (eye / eye-off, lock / unlock) and a pressed-state outline in forced colours; the buttons show on
  hover, on focus, on the selected row and always while pressed. The tree is one tab stop: Up and Down move, Home and
  End jump, Right opens a group or goes to its first child, Left closes it or goes to its group, Enter selects, F2
  renames, H hides or shows the selected row. At most 500 rows are listed and the list says "Showing 500 of N". The
  search field (the `/` key focuses it, except while typing in a field) keeps the rows whose label contains the text
  and the groups above them, opened for the search without touching what you collapsed, marks the matches with
  `<mark>` text nodes and says "N matches". "More" holds Expand all and Collapse all. Which groups are collapsed is kept
  per model (`collapsedNodes`, see [Local state](#local-state-v1)); it is not an undo step, so Undo and Redo leave the
  collapse, the selection and the search alone. The Lights group has a button for the look's key and rim light with
  its colour swatch, each opening the Light tab on it, and the footer counts nodes, cubes and clips. The Add menu has
  "Open model" and a disabled "Add light" (user-placed lights are not available yet). Labels and locks are app
  labels: they never change the scene document, an export or a pixel. Rebuilding the list for a model of about 2000
  rows (a search keystroke, Collapse all, a selection) blocks the main thread under 50 ms, held by `app.outliner.spec.ts`.
- **Inspector**: a vertical icon rail (56 px, so it cannot wrap at 260-520 px) of five tabs, each an icon over its label;
  ArrowUp/Down and Left/Right, Home and End move between them, and the selected tab is styled by `aria-selected`
  only, so focus never changes it (forced colours: a 3 px left border). Above the panels a title row names the
  selected node or element with a type tag (Group, Element), or the tab. Panels are built from collapsible sections
  (a header button with `aria-expanded` / `aria-controls`; the open state is kept, see [Local state](#local-state-v1)).
  Only what an existing path applies to both the preview and the render is editable; the rest is shown read-only with
  its source named ("from the file", "from the look") and nothing is a disabled placeholder.
  - **Object**: Name; State (Visible, Locked); Transform (Position in px and Rotation in degrees as XYZ rows, Scale
    read-only "from the file"); Animation (the keyframe times of the node's channels in the clip the timeline shows,
    each a button that moves the playhead there; adding keyframes is not available); the player's Arms as a segment.
    An XYZ row is three text fields with `inputmode="decimal"` labelled "Position X" and so on: type a value, step
    with ArrowUp/Down (Shift x10, Alt x0.1, one undo step per press), or drag an axis letter (one undo step on
    release, Escape cancels). A value that is not a number or beyond +-1e6 reverts, is marked `aria-invalid` and
    says so; a field committed with Tab leaves the focus on the next field.
  - **Material**: nothing selected says to select something; a group lists the elements below it as "Select <name>"
    buttons with their materials (capped at 100); an element shows Texture (a thumbnail drawn on a canvas, never an
    `<img>`: the page policy allows no `blob:` images; file name and size), Filtering (Nearest, the pixel-art
    default, or Linear per texture, applied to the preview and the render), Transparency (alpha mode, cut-out
    threshold, alpha emission, blending, sides: read-only, from the file) and Edges (rounding and sharp angle,
    read-only, from the look, with "Change in Look").
  - **Light**: the look's lights as it defines them, read-only: key, fill and rim each with a colour swatch and hex,
    intensity (the strongest channel), key softness in degrees, azimuth and elevation with a top-view dial (a black
    light shows "Off"), the environment (a dome's sky and ground or an image's name, intensity and rotation), a
    Shadows section (the key casts shadows, fill and rim do not, the catcher strength) and Other lights (buttons
    that move the focus to a light). Lights come from the look: choose another in Look.
  - **Look**: one radio card per look preset ([look-presets.md](look-presets.md)): a swatch painted from the look's own
    data (backdrop gradient, a glow in the key's tint, a rim line when the rim is lit; CSS only, nothing is rendered),
    its name and one line, a check on the active card, `L` shown in the header. Arrow keys move the choice, one tab
    stop; a card, the `L` key, Undo and a reload all mark the same card (`LookPanel.show`). Under the cards,
    Backdrop (Scene, or a flat Colour) and Grading (Exposure -6..+6 EV, Saturation 0-200 %) adjust the look.
    An adjustment is `session/adjustLook.ts` on top of the preset, handed to the preview and the path tracer through
    `session/applyLook.ts`, the one place that sets the look and edges on the viewer, the tracer and the bake, so both
    draw it alike. It changes nothing baked light depends on (`lightingKey`: key, dome or image), so it starts no
    bake. A slider previews while it moves and is one Undo step when released; choosing a card drops the adjustment
    (Undo brings both back); Reset adjustments clears it. It is kept with the model (`lookAdjust`, see
    [Local state](#local-state-v1)). A transparent backdrop is not offered: the render has no alpha output (Export
    owns transparency).
  - **Render**: Quality (sample chips 64, 256 and 1024 beside a number field 1-4096, supersampling 1x-4x as a
    segment, denoise) and Output (the size of the render, which is the size of the 3D view, "traced at" the
    supersampled size, and a time estimate that appears only after a render has finished in this session, from that
    render's speed scaled by pixels and samples, labelled an estimate). Render starts from 256 samples because it
    draws one still; Export starts from 64 because a clip renders many frames: both say so beside their field. Below
    them the **Camera** section (collapsible): the four presets, field of view (disabled in orthographic),
    perspective or orthographic, Frame and Reset. The presets mirror the chips over the view: one `sync` marks the
    preset the camera stands at (angles within 0.5 degrees, and the isometric one only in orthographic) with
    `aria-pressed` on both, and an orbit, the O and I keys or any other change of angle or projection clears the mark.
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
  0.2 s after a pause or the end of a scrub), so the preview shows the shadows of what it shows. Each
  change of the scene (an edit, the release of a gizmo drag too, visibility, a filter, Undo) bakes once, at once: at
  rest the scene as changed, at a clip pose that pose (also one the playhead moved to while the scene was being set), never the rest pose first, during
  playback the frame shown (and the pose it stops on after the pause). A scene change that fails leaves the old scene
  and shows the pose the playhead stands at. Any bake (a look, a new model) settles a relight still due, so a look
  picked right after a scrub or a model opened during playback bakes once; a drag commit the scene refuses pays a
  relight that fell due during the drag at once. A gizmo handle takes no new drag while the last one is being committed,
  and no drag is committed while files open. Changes made before files are opened are applied to the model they were
  made for before the new one is shown. A look picked while files open is kept unless the model has a saved
  look. Starting a render, opening Export or opening
  another model pauses playback, and playing or scrubbing during a render cancels it. A model without animations shows
  "This model has no animations" beside a disabled Play in the one-row bar; the clip choice, Loop and the playhead
  come with the first clip.
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
| Esc                      | stop the render, close dialogs, menus and drawers                    |
| 1, 2, 3, 4               | front, side, three-quarter, iso                                      |
| L                        | next look (the Look tab's cards mark it; `aria-checked` follows)     |
| G                        | all overlays off, or back on                                         |
| [ and ]                  | outliner and inspector                                               |
| /                        | search the outliner (not while typing in a field)                    |
| T                        | timeline                                                             |
| ?                        | the shortcut list                                                    |
| H                        | show or hide the selected node                                       |
| W and E                  | move and rotate gizmo                                                |
| F2                       | rename the selected node                                             |
| Space                    | play or pause (a focused button, link, tab or separator keeps Space) |

## Local state v1

The dismissed shortcut hint is one flag in `localStorage` key `modelshot-hints-v1` (`state/HintStore.ts`; a blocked store
never throws). "Forget local data" clears it and the dialog names it, so the row shows again after the next open.

IndexedDB `modelshot-app`, version 1, on this device only:

- store `session`, key `current`: `{ v: 1, files, modelKey, savedAt }`, the files of the last open model, reopened on
  a start without handoff;
- store `models`, key = SHA-256 hex of the model bytes: `{ v: 1, camera, look, hiddenNodes, hiddenMeshes, textureFilters?, arms?, names?, lockedNodes?, lockedMeshes?, nodeEdits?, lookAdjust?, collapsedNodes?, render, export?, savedAt }`,
  restored when the same model is opened again. At most 20 entries; the oldest is evicted. `names` maps
  `n:<node index>` / `m:<mesh index>` to a label of at most 128 characters, the locks are index lists and `nodeEdits`
  is `{ node, translation, rotation }[]` (finite, at most `MAX_ANIMATION_VALUE`); `lookAdjust` is `{ exposure -6..6, saturation 0..2, backdrop: null or "#rrggbb" }` (a malformed one is dropped on its own); `collapsedNodes` is a list of node indices (at most 100000, a malformed list is dropped). A record from before the editor lacks
  them and reads as before; a bad entry is dropped on its own.

The panel layout is not in this database: it is `localStorage` `modelshot.layout.v1`
([Editor layout](#editor-layout)). Which inspector sections are closed is `localStorage` `modelshot.sections.v1`
(`ui/sectionState.ts`): an object of `"<section id>": false` for the closed ones, at most 2 KB, unknown ids and
other values dropped, anything unreadable leaves every section open; a blocked store keeps the choice for the session and
tells the user once. "Forget local data" removes it with the layout.

Saves are debounced by 500 ms. Reads are validated as untrusted (`state/readAppState.ts`: own properties, `v === 1`,
finite values in range, a known look, real `File` objects) and never throw; an invalid record is ignored. A full disk
or a failing database shows a notice and the app goes on. "Forget local data" first asks in a dialog that names what goes
(the files of the last model, the view and settings kept per model, the panel layout, the dismissed shortcut hint); Escape and Cancel keep
everything and return the focus to the File button, and confirming deletes the database and the stored layout. New fields are optional; a breaking change bumps the version and ships a migration or discards the
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
share sheet on a click; the app makes no request for it. The empty state says it in one line: "Your file stays in this browser tab and is never uploaded." The File menu footer says where the data is kept.

## Visual system

Three layers, so a screen picks classes and never a colour (MS-101; MS-102..110 build the structure on it).

1. Brand tokens (`packages/brand/src/tokens.ts`, [brand.md](brand.md)): the only source of a colour, size or radius.
2. `--ed-*` aliases in `:root` of `app.css`: `--ed-ground`, `--ed-panel`, `--ed-raised`, `--ed-field` (surfaces),
   `--ed-text`, `--ed-text-2`, `--ed-text-3` (paper, `textSecondary`, `textHint`), `--ed-accent` (Shot Blue),
   `--ed-accent-hi` (`blueMid`, the "blue light"), `--ed-sun`, `--ed-flash`, `--ed-ok`, `--ed-ax`/`--ed-ay`/`--ed-az`,
   the alpha layers `--ed-line` (paper 7 %), `--ed-line-strong` (14 %), `--ed-hover` (5 %), `--ed-press` (9 %),
   `--ed-accent-soft` (Shot Blue 18 %) as `color-mix` of tokens, the sizes `--ed-row-h` and `--ed-field-h` (30 px),
   `--ed-control-h` (32 px), `--ed-bar-h` (48 px), the radii `--ed-radius-key` 6, `-field` 8, `-ui` 10, and the focus
   ring `--ed-ring`.
3. Element defaults and component classes below. A raw colour in `app.css` fails `noRawColours.test.ts`.

Type: Manrope 500 at 13 px for the body, 700 for labels and buttons, 12 px for captions and hints, an 11 px uppercase
overline for panel headings (`.overline`, `.panel-head h2`), IBM Plex Mono for numbers (readouts, number fields,
stats, keycaps), Unbounded only for the logo, the drop overlay and the title of the empty card. Controls inherit the
font (`font: inherit`).

Element defaults (no class needed): `button` is the secondary button (transparent, 1 px `--ed-line-strong` border, 32
px, radius 10); a checkbox is a 34x20 toggle, a radio outside `.segment` a round radio, a range a 4 px track with a 14
px thumb, number, text, search and select are 30 px fields on `--ed-field` (the select chevron is two gradients, no
`data:` image), `kbd` a keycap, `.segmented` / `.segment` a field track whose checked segment is raised, a selected
tab in the inspector rail is a soft blue wash with a blue light left bar. `[hidden]` always wins over a component's `display`.

Classes (stable names): `.primary` (the only button fill in Shot Blue: Render in the render bar, Export in the top bar
and the dialog Export; a checked toggle's track is the one other use), `.ghost` (no border, secondary text), `.destructive` (Flash
border and text), `.icon-button` 32 px and `.icon-button.small` 26 px (an icon alone; the helper sets `aria-label`),
`.small` (a 26 px text button), `.on`, `[aria-pressed='true']` and `.bar-toggle[aria-expanded='true']` (the active
state: soft blue wash, blue light text), `.slider` (a range with its number field), `.xyz` (three number fields in `.xyz-cell`s, each with its `.xyz-axis` letter, coloured by `--ed-ax`, `--ed-ay`, `--ed-az`), `.section` / `.section-head` / `.section-body`, `.rail-layout`, `.toggle-row` (label left, toggle right), `.overline`. A disabled
control keeps its fill at 40 % opacity with `cursor: not-allowed`, so it never looks like an active one.

Icons: `src/ui/icon.ts` draws `ICON_NAMES` (eye, lock, chevron-down, -right, -left, -up, plus, undo, redo, search,
cube, sun, camera, play, loop, frame, share, download, more, panel-left, panel-right, panel-bottom, close, eye-off, unlock, material, look, render, keyframe, folder) as a 16 px (or 14 px) SVG on a 16 grid, stroke 1.7, round
caps, `currentColor`, `aria-hidden`, built with `createElementNS` (never `innerHTML`); `src/ui/iconButton.ts` wraps
one in a named button. The paths are drawn for the project: no icon set, no licence entry.

Control specimen: the e2e build adds `window.__msApp.showSpecimen()`, a full-window page of every variant in default,
on and disabled (`src/ui/specimen.ts`, imported only by `e2eHook.ts`, so the production bundle never holds it).
`e2e/app.system.spec.ts` checks it: goldens at 1440 and 375 px (`packages/app/goldens`, regenerated with `pnpm
golden:update:app`, refused in CI), axe, hover and focus on every control, disabled against on, and that only primary
buttons are blue on the real screens.

## Accessibility

The empty card is a section named by its heading, Open carries `aria-keyshortcuts`, and the entry cards are buttons; the
first-run row is a named region whose dismiss button hands the focus to the 3D view.

Landmarks (header, outliner `nav`, view `main`, inspector `aside`, timeline `section`, the empty card `section` named by its
heading, the Shortcut hints region; the toasts are live regions, not landmarks),
every control labelled, visible focus (a 3 px `--ms-color-blue-mid` ring, 2 px off the control, on every control of
the dark workspace; the viewport chips sit over the 3D view, so their ring has a ground halo under it), errors in
`role="alert"` until dismissed or the next open, arms change or render (the Dismiss button sits beside it, not inside;
the pinned graphics-driver alert, a context that cannot be restored or a linear program that fails to link during the
fallback switch, where drawing goes on with nearest filtering, survives those and goes only when dismissed), one `role="status"` line, the render progress as
a `progress` with `aria-valuetext`, the forget dialog with its focus back on File, native controls and dialogs, tabs (a vertical rail), the outliner tree, radio cards, collapsible sections and separators with their ARIA
patterns, the overlay canvas `aria-hidden`, colours only from the brand tokens ([brand.md](brand.md)). In forced
colours the native checkbox, radio and select return and every active state (`.on`, pressed, the checked segment, the
selected tab, the current outliner row) gets a system-colour outline or bar. Axis letters keep 4.5:1 on the field surface; an XYZ field with an invalid value is `aria-invalid` and its hint is a polite status. Every panel is reachable by keyboard; the
shortcut list is the cheat sheet.

## Tests

Vitest in `packages/app/test`; Playwright in `packages/app/e2e` (`pnpm --filter @modelshot/app run test:browser`):
flow, formats, camera, persistence, hostile files, offline, network, handoff, accessibility and preview/render parity,
and the editor: `app.editor.spec.ts` (picking, gizmo, undo, names and locks, the inspector tabs, looks, render and camera), `app.outliner.spec.ts` (the tree, collapse, search, keyboard, the 2000-row rebuild), `app.timeline.spec.ts`,
`app.topbar.spec.ts` (one row from 1440 to 900 px, More below, one primary, the File menu from the keyboard, the forget
dialog, a message or the longest error covers no view control, render bar button or first-run row from 375 to 1440 px, a
cut-off message scrolls under the wheel and the camera stays), `app.render.spec.ts` (render start, Stop and Esc, numbers, result line, the view keeps its size),
`app.empty.spec.ts` (the empty state at 1440 and 375 px, keyboard Open, entry cards and their accept, drag-over and drop,
unsupported and truncated files, an error on a phone covers neither the card nor the render bar, no band under the canvas, the empty panels and the timeline bar, the first-run row;
the `firstRunHint` fixture option shows the row, otherwise every spec starts with it dismissed),
`app.layout.spec.ts` (1280, 1440, 1920 and 900 px with screenshots in `test-results` for review, resize, collapse,
drawers, the view keeps its size when a model without clips opens), `app.overlay.spec.ts` (toggles; overlays never in the preview, render or export), `app.motion.spec.ts`
(reduced motion, overlay draw time) and `app.system.spec.ts` (the control specimen and its goldens, blue only on
primaries, chip focus ring, forced colours, the dot and toast borders). Bundle budgets: [testing.md](testing.md#budgets).
