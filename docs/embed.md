# Embed

Shows a live, turnable model on any page: a marketplace listing, a wiki, a blog. Two ways, one result: the
`<modelshot-viewer>` element, or a plain `<iframe>` of the frame page. The model is downloaded from its URL, read and
drawn in the frame with the app's realtime preview and light bake; nothing else is sent anywhere. The frame and the
model's server get no cookie, referrer or host page data. The one thing the embed server sees of the host page is the
request for `modelshot-embed.js`: a module script is fetched in CORS mode, so it carries the host's `Origin` header
and, under the host page's referrer policy, a `Referer`; `referrerpolicy="no-referrer"` on the script tag withholds
the latter.

```html
<script
  type="module"
  src="https://mrlarkyy.github.io/ModelShot/embed/v1/modelshot-embed.js"
  referrerpolicy="no-referrer"
></script>
<modelshot-viewer model="https://example.com/models/lantern.bbmodel" look="marketplace" autorotate></modelshot-viewer>
```

```html
<iframe
  src="https://mrlarkyy.github.io/ModelShot/embed/v1/#v=1&model=https%3A%2F%2Fexample.com%2Fmodels%2Flantern.bbmodel&look=marketplace"
  title="Lantern, 3D model"
  width="400"
  height="400"
  style="border: 0"
  sandbox="allow-scripts allow-same-origin"
  referrerpolicy="no-referrer"
  loading="lazy"
></iframe>
```

The embed build (`pnpm --filter @modelshot/embed run build`, `packages/embed/dist`) is the frame page `index.html`,
the element script `modelshot-embed.js` next to it and their `assets/`. Every URL in it is relative, so it can be
served under any path. It is published at `https://mrlarkyy.github.io/ModelShot/embed/v1/` (live after the first deploy, docs/hosting.md); the folder name is the
contract version (`v1` is `EMBED_PARAMS_VERSION`), so a breaking change gets a new folder ([hosting.md](hosting.md)).
A host page loads `modelshot-embed.js` (one self-contained file) as a
cross-origin module script, so the embed server must send `Access-Control-Allow-Origin: *` for the
`.js` files.

## How it works

The element is a small loader (about 3 kB gzip, budget row `embed`). It checks its attributes and, when it comes within
200 px of the viewport, inserts an iframe of the frame page with the parameters in the URL fragment. The frame page
(budget row `embed-frame`) does the work:

1. reads the parameters from `location.hash` (never the query string);
2. checks the file name of the model URL with the app's intake rules (extension; one model or one skin PNG);
3. starts the WebGL2 viewer (`WEBGL2_UNAVAILABLE` without it);
4. downloads the model (limits below) and, for a `.gltf`, `.glb` or `.obj`, the files it refers to on the same server
   (see [Models with several files](#models-with-several-files)), checks them again with the intake limits and reads
   them in the app's load worker (30 s watchdog, the loaders' own limits), as if they had been picked together;
5. shows it with the chosen look and camera, posts `load` to the host and bakes the light lazily (status
   "Preview lit.");
6. turns it if `autorotate` is on, once the light is baked (turning while the bake runs would slow it), unless the
   visitor moved the model first.

Because the frame page and its workers come from the embed's own origin, the load worker and the light-bake worker
start normally on any host page; a hostile model can hang only the frame's worker, never the host page, and the
worker is stopped after 30 s.

## Frame parameters

Version 1. In the fragment of the frame page URL, `name=value` pairs joined by `&`, each value encoded with
`encodeURIComponent` (a `+` left raw reads as a space). At most 8192 characters after the `#`.

| name         | value                                                                                                                                                     | default             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `v`          | `1`, the contract version; absent reads as 1                                                                                                              | 1                   |
| `model`      | absolute `http` or `https` URL of a `.bbmodel`, `.glb`, `.gltf` (embedded data), `.obj` or skin `.png`, at most 2048 characters, no user name or password | required            |
| `look`       | `studio`, `marketplace` or `rim` (the [look presets](look-presets.md))                                                                                    | `studio`            |
| `yaw`        | camera yaw in degrees, a decimal in -360..360                                                                                                             | 210                 |
| `pitch`      | camera pitch in degrees, a decimal in -89.5..89.5                                                                                                         | 20                  |
| `fov`        | vertical field of view in degrees, a decimal in 10..100                                                                                                   | 35                  |
| `autorotate` | empty, `true` or `1` turns the model; `false` or `0` does not                                                                                             | off                 |
| `background` | `#rgb` or `#rrggbb`, the colour shown behind the model (see below)                                                                                        | the look's backdrop |
| `arms`       | `classic` or `slim`, the arm width of a skin PNG                                                                                                          | `classic`           |

Decimals are written plainly: `-12.5`, `30`; no exponent, plus sign, spaces, `NaN` or `Infinity`. The model is framed
to fit from the given angles.

Rules: an invalid value of a known parameter is an error (`INVALID_PARAM` naming it), never a silent default; a
parameter given twice is an error; an unknown parameter is ignored with a console warning, so an older frame accepts
a newer element's URL. A change of meaning or a removal makes version 2, and the frame keeps reading version 1;
an added parameter, value or error code stays version 1.

Why the fragment: the browser never sends it to the server hosting the embed, so that server learns nothing about
what is shown. A query string is ignored.

`background` is the colour as the page shows it (sRGB). The backdrop goes through the look's view transform (AgX tone
mapping, exposure and grade) like the rest of the picture, so the frame solves for the scene-linear colour that this
transform shows as the given one: `#1b2a4a` comes out as `#1b2a4a` within a level. AgX cannot show every colour; a very
saturated one (`#ff0000`) gives the closest it can. The look's light and shadow catcher stay; only the backdrop
becomes that flat colour, as the renderers' `background` option does it.

## Element attributes

`<modelshot-viewer>`, defined by `modelshot-embed.js` (an ES module; defining twice is skipped). The attributes are
the frame parameters but `v`, with the same values, plus two of its own.

| name         | value                                                                              | default             |
| ------------ | ---------------------------------------------------------------------------------- | ------------------- |
| `model`      | as the parameter; a relative URL is resolved against the page (`document.baseURI`) | required            |
| `look`       | as the parameter                                                                   | `studio`            |
| `yaw`        | as the parameter                                                                   | 210                 |
| `pitch`      | as the parameter                                                                   | 20                  |
| `fov`        | as the parameter                                                                   | 35                  |
| `autorotate` | a boolean attribute: present (empty, `true`, `1`) turns, `false` or `0` does not   | off                 |
| `background` | as the parameter                                                                   | the look's backdrop |
| `arms`       | as the parameter                                                                   | `classic`           |
| `loading`    | `lazy`: insert the frame within 200 px of the viewport; `eager`: at once           | `lazy`              |
| `label`      | the iframe's accessible name, at most 200 characters                               | "3D model viewer"   |

Changing an attribute shows the new model or view (only the fragment changes, so the frame page is not loaded again): the
frame keeps its viewer, and for the same model its loaded document, so a new look, camera, background or `autorotate`
needs no download and no second WebGL context (a new look bakes the light again); a new `model` is set into the same
viewer. The latest attributes win: a model download they no longer ask for is aborted (changing `model` to another and
back shows the first one, without the other), and a model that arrives after a newer change is replaced by the model
that change asks for. The Home key returns to the `yaw` and `pitch` of the attributes. An invalid attribute fires
`error` once per distinct error, also when the page loads the element script after the element's markup.
An invalid attribute shows the error inside the element (an alert, no frame) and fires `error`. The element is 300 x 300
CSS pixels unless the page sizes it (`modelshot-viewer { width: 100%; height: 480px }`); the frame fills it. Without
`IntersectionObserver` it loads at once; a hidden element (`display: none`) does not load until shown.

The iframe is sandboxed (`allow-scripts allow-same-origin`: scripts and its own origin for its workers; no top
navigation, popups, forms or downloads), has an empty `allow` list and `referrerpolicy="no-referrer"`.

## Events

The element fires, on itself (not bubbling, not composed):

- `load`, `detail` `{}`: the model is shown (the light bake may still be running); fired each time the frame turns to
  showing a model from loading or an error (a new `model`, a change back to the shown one, a valid change after an
  error), never for a look, camera, background or `autorotate` change;
- `error`, `detail` `{ code, message }`: an invalid attribute, or why the frame shows no model.

A host page with a plain iframe changes the parameters with `iframe.contentWindow.location.replace(url)` (allowed across
origins): only the fragment changes, so the frame keeps its viewer, and the host page's history gets no entry (a new
`src` adds one per change, so Back would step through the earlier models). The element does the same.

The frame page posts the same to its parent window, for a plain iframe:
`{ source: 'modelshot-embed', v: 1, type: 'load' | 'error', code?, message? }` with target origin `*` (the frame does
not know its host; the message carries no model data). The element relays only messages from its own iframe and the
embed origin.

## Errors

Shown in the frame (or the element) as `<code>: <message>`, in a `role="alert"` element, and reported by `error`.

| code                  | when                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MISSING_MODEL`       | no `model`                                                                                                                                                                                                                                                                                                                                   |
| `INVALID_PARAM`       | a value outside its contract, a parameter given twice, or a fragment over 8192 characters; names the parameter                                                                                                                                                                                                                               |
| `UNSUPPORTED_VERSION` | `v` other than 1                                                                                                                                                                                                                                                                                                                             |
| `MODEL_URL_INVALID`   | `model` not an absolute http(s) URL, with credentials, control characters, or over 2048 characters                                                                                                                                                                                                                                           |
| `MODEL_INSECURE`      | an `http` model on an `https` frame: refused before any request (the browser would block it)                                                                                                                                                                                                                                                 |
| `MODEL_CORS_BLOCKED`  | the model server answered but does not allow the embed origin to read the model or one of its files (see CORS); a file of the model is named                                                                                                                                                                                                 |
| `MODEL_UNREACHABLE`   | no answer for the model or one of its files: offline, a wrong address, a refused connection, the connection broke mid-download, or (some browsers, see CORS) a server without `Access-Control-Allow-Origin`                                                                                                                                  |
| `MODEL_HTTP_ERROR`    | the server answered with an error status (404, 403, ...) for the model or one of its files, named in the message                                                                                                                                                                                                                             |
| `MODEL_TOO_LARGE`     | the model over 64 MiB, or the model and its files together, from `Content-Length` before reading or while streaming without it                                                                                                                                                                                                               |
| `MODEL_FETCH_TIMEOUT` | the model's download (headers and body) took over 30 s, or the downloads of its files together took over 30 s                                                                                                                                                                                                                                |
| `SIDECAR_REFUSED`     | the model refers to a file the embed will not download: a URL or scheme (`https:`, `data:`, `javascript:`, `file:`, ...), a `//` or backslash authority, a path leading to another origin, over 2048 characters once resolved, or two files of one name at different URLs; refused before any of its files is requested, the reference named |
| `TOO_MANY_SIDECARS`   | the model refers to more than 31 files the embed would download; refused before any of them is requested (an OBJ's textures before any texture is requested)                                                                                                                                                                                 |
| `WEBGL2_UNAVAILABLE`  | the browser has no WebGL2                                                                                                                                                                                                                                                                                                                    |
| `SCENE_REJECTED`      | the renderer did not take the model                                                                                                                                                                                                                                                                                                          |

Codes of the app's intake and of the loaders pass through unchanged (see [App, Files and limits](app.md) and the
loader pages): `UNSUPPORTED_TYPE` (no model extension in the URL path), `NO_MODEL`, `LOAD_TIMEOUT` (reading took over
30 s), `LOAD_FAILED`, `NOT_JSON`, `NOT_BBMODEL`, `FILE_TOO_LARGE`, `TOO_MANY_TRIANGLES`, `TEXTURE_TOO_LARGE`, ...;
and the renderer's `INVALID_SCENE` and `SCENE_TOO_LARGE`. A referenced file the embed skips (see below) or the server
does not have is the loader's: a missing `.gltf` buffer fails with `MISSING_BUFFER`, a missing texture or material
library is drawn missing or plain with the loader's warning.

## Models with several files

A `.gltf` with external buffers and images, or an `.obj` with `mtllib` material libraries and their `map_Kd`
textures, loads by URL like the same files picked together in the app. After the model, the frame lists its
references with the loaders' own parsers (`listGltfReferences`, `listObjReferences`, `listMtlReferences` of
`@modelshot/formats`) and resolves each against the model URL (an OBJ texture against its `.mtl` file's URL, as
exporters write them):

- Only a relative path is downloaded (`model.bin`, `textures/skin%20A.png`, `../textures/a.png`, `/models/a.png`),
  and only when it lands on the model's own origin over http(s). A URL with a scheme (even the model's own
  `https://...`), `//host`, a backslash authority or anything leading elsewhere after the browser's URL parsing fails
  the model with `SIDECAR_REFUSED` before any of its files is requested. `data:` URIs of a `.gltf` are decoded by the
  loader, never requested.
- Only `.bin`, `.png` and `.mtl` files are downloaded, what the app takes next to a model; another reference (a
  `.jpg`, a path with a query) is left to the loader, which reports it missing as in a local open.
- Each URL is downloaded once, one after another in the model's order. The loader finds a file by its name, so two
  URLs ending in the same file name (`a/skin.png`, `b/skin.png`, case ignored) are refused with `SIDECAR_REFUSED`.
- At most 31 files (32 with the model, the app's limit), checked before the first request (`TOO_MANY_SIDECARS`); the
  model and its files share the 64 MiB, and the files share one 30 s limit from their first request.
- A `.bbmodel`, a `.glb` with its BIN chunk and a `.gltf` or `.obj` that refers to nothing make no request but the
  model's.

The files need the same CORS header as the model (below).

## CORS: serving models

The frame downloads the model from the embed's origin, so the model's server must allow that origin to read it:

```
Access-Control-Allow-Origin: *
```

or the embed origin itself. The request is a plain `GET` without cookies or credentials, so nothing else is needed (no
`Access-Control-Allow-Credentials`, no preflight). Examples:

- nginx: `location /models/ { add_header Access-Control-Allow-Origin *; }`
- Apache: `Header set Access-Control-Allow-Origin "*"` in the directory of the models
- GitHub Pages and most static file hosts send `Access-Control-Allow-Origin: *` already.

The URL path must end in the file's extension (`/lantern.bbmodel`; a query string after it is fine), because the
format is chosen from it before the download.

When the download fails without any response, the browser does not say whether the server refused CORS or was never
reached. The frame then sends one `HEAD` request to the same URL in `no-cors` mode (no credentials, no referrer, 10 s
limit): if the server answers it, the error is `MODEL_CORS_BLOCKED`, naming the model origin, the embed origin and the
header to add; if not, `MODEL_UNREACHABLE`. A file of the model that fails so is probed the same way, and the error
names it: the server must send the header for the files next to the model too. Besides the model's files, that probe
is the only other request the embed makes. Some browsers
fail the `no-cors` probe too when the server sends `X-Content-Type-Options: nosniff` with a type they block for opaque
responses (such as `application/json`), so a server without the header can also end in `MODEL_UNREACHABLE`: its message
names a missing `Access-Control-Allow-Origin` as a possible cause.

## Limits

| limit             | value                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| model download    | 64 MiB, 30 s for headers and body                                                                   |
| model's files     | 31, relative paths on the model's origin only; 64 MiB together with the model; 30 s for all of them |
| CORS probe        | one `HEAD`, 10 s                                                                                    |
| model URL         | 2048 characters                                                                                     |
| fragment          | 8192 characters                                                                                     |
| `label`           | 200 characters                                                                                      |
| reading the model | the app's 30 s worker watchdog and the loaders' own limits (elements, triangles, textures, nesting) |

## Privacy

- No analytics, tracking, cookies, storage or third-party request. The frame's Content-Security-Policy allows scripts,
  styles, images and workers from the embed origin only (no `blob:` or `data:`); `connect-src` allows the model download.
- The embed server receives only the requests for its files: the parameters are in the fragment.
- The model server receives one `GET` for the model and one for each file it refers to (at most 31, see
  [Models with several files](#models-with-several-files)), and at most one `HEAD` probe per failed request, all
  without cookies and without `Referer` (`referrerpolicy="no-referrer"` on the iframe,
  `<meta name="referrer" content="no-referrer">` in the frame, and on the request), so it does not learn which page
  shows its model. No other server is asked for anything a model refers to.
- Nothing is posted to the host page but `load` and `error`.

## Accessibility and motion

The iframe is titled with `label`. Inside, the canvas is focusable and named; arrow keys, drag and wheel turn and zoom
as in the app. Loading and lighting progress is announced in a `role="status"` element (visible while loading, for
screen readers only once the model shows); errors in a `role="alert"` element. `autorotate` never starts when the
visitor prefers reduced motion, stops when that setting turns on and stops for good on the first pointer, wheel or
key input in the frame. An error stops it (nothing turns behind the alert); it starts again once a model is shown
with `autorotate`. The light bake runs only when a model is shown; the renderer and orbit easing follow
reduced motion as in the app.

## Tests

`packages/embed/test` (Vitest): the frame's model switching, status and failure handling with a fake viewer
(`showEmbed.test.ts`), the parameter parser at every boundary and with hostile values, the frame URL round
trip, the download limits and the CORS probe with fake `fetch`, the reference policy against a table of hostile
references (`resolveSidecarUrl.test.ts`), the files of a model with their count, name, size and time limits and the
loaders resolving them (`fetchSidecars.test.ts`), autorotate with a fake clock, the backdrop colour
solve for every look, no network API outside the download, and that this page's tables equal the code
(`contractDocs.test.ts`). `packages/embed/e2e` (Playwright, SwiftShader, `pnpm --filter @modelshot/embed run
test:browser`): the element and a plain iframe on a host page of another origin (lit preview, looks, camera,
background, autorotate, reduced motion, attribute changes), lazy loading, the CORS, unreachable and HTTP errors, the
size and time limits with the host page staying responsive, the requests made, and a `.gltf` and an `.obj` with
their files on the model server (textures drawn, requests only to the model's origin) beside hostile references,
too many files and a texture without CORS (`embed.sidecars.spec.ts`, models made by
`e2e/fixtures/sidecars/generate.mjs`, CC0). Described in [Testing](testing.md).
