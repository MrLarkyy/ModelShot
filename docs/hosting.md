# Hosting

ModelShot is a static site on GitHub Pages: no server code, no database, no account. The repository is on GitHub, so
the host adds no party and needs no secret.

## Layout and URLs

One artifact (`tools/deploy`, `pnpm -r build` writes `tools/deploy/dist`):

| Path in the site | Content                        | Public URL                                                         |
| ---------------- | ------------------------------ | ------------------------------------------------------------------ |
| `/`              | landing page (`packages/site`) | `https://mrlarkyy.github.io/ModelShot/`                            |
| `app/`           | the app (`packages/app`)       | `https://mrlarkyy.github.io/ModelShot/app/`                        |
| `embed/v1/`      | embed frame and element script | `https://mrlarkyy.github.io/ModelShot/embed/v1/modelshot-embed.js` |

Every build uses the relative base `./`, so the same files work under `/ModelShot/` and, after a custom domain, at the
domain root. The assembly (`tools/deploy/src/checkDist.ts`) fails the build on a root-absolute URL, a script or
stylesheet from another origin, a missing page policy, or a missing `app/sw.js` or `embed/v1/modelshot-embed.js`.

### Embed path versioning

The folder `embed/v<n>/` carries the embed contract version (`EMBED_PARAMS_VERSION`, [embed.md](embed.md)); a test
pins the two together. `v1` moves with each deploy and stays compatible (parameters are only added). A breaking change
raises the version and needs a new folder; the old one then has to stay in the artifact, which is not done yet.

## Content Security Policy

Pages cannot set headers on GitHub Pages, so each HTML file carries a `<meta http-equiv="Content-Security-Policy">`
as the first element after the charset, before any script or link:

- app and landing page: `default-src 'self'` with `script-src`, `connect-src`, `img-src`, `style-src`, `font-src`
  `'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; `worker-src 'self'` in the app, `'none'` on
  the landing page. No `'unsafe-inline'`, no wildcard, no host.
- embed frame: the same, except `connect-src 'self' https: http:`: the frame fetches the model URL its host page
  names, which is the purpose of the embed. Nothing else may leave it.
- `frame-ancestors` is never set (a meta policy ignores it anyway, and the frame must be embeddable), and GitHub Pages
  sends no `X-Frame-Options`.

A meta policy does not apply inside workers; the worker code makes no requests (`packages/app/test/noNetwork.test.ts`).
No SharedArrayBuffer and no WebAssembly are used, so no cross-origin isolation headers are needed.

## What the host sees

GitHub, as host, sees the request log of any host: IP address, user agent and the files asked for. Models, skins and
state never leave the browser; the deploy suite asserts that every request is a GET without a body to the site's own
origin. Network traffic beyond that happens only on an explicit share.

## Caching

GitHub Pages sends `Cache-Control: max-age=600`. Built files carry a content hash in their name, so a new deploy
brings new names; `index.html`, `app/sw.js` and `embed/v1/modelshot-embed.js` keep their names and can be up to ten
minutes old. The app's service worker checks `sw.js` bypassing the HTTP cache and a new version waits until the open
tabs are closed ([app.md](app.md#offline)). An embed frame that a cached page still points at a removed chunk shows a
status or an error and does not hang (`deploy.embed.spec.ts`).

## Shared origin

All project pages of `mrlarkyy.github.io` share one origin, so IndexedDB and caches are shared with the owner's other
Pages sites. A custom domain isolates them.

## Deploying

`.github/workflows/pages.yml` runs on every push to `main` and on demand, and does nothing until the repository variable
`PAGES_DEPLOY` is `true`. To turn it on:

1. Settings, Pages, Source: GitHub Actions.
2. Settings, Secrets and variables, Actions, Variables: `PAGES_DEPLOY` = `true`.
3. Actions, `pages`, Run workflow.

Jobs: `build` installs, builds and uploads the artifact with only `contents: read`; `deploy` is the only job with
`pages: write` and `id-token: write` and runs nothing but `deploy-pages`; `verify` runs the deploy suite against the
live URL once the live `app/sw.js` equals the artifact's.

Rollback: unset `PAGES_DEPLOY` to stop further deploys; revert the commit and push; or re-run an older successful
`pages` run (its deploy job).

## Tests

`pnpm --filter @modelshot/deploy run test:browser` serves the built `tools/deploy/dist` under `/ModelShot/` the way
Pages does (`e2e/staticServer.ts`: MIME types, `Access-Control-Allow-Origin: *`, `max-age=600`, no framing headers) and
runs the flow, CSP, offline, embed and header specs. With `MS_DEPLOY_URL=https://mrlarkyy.github.io/ModelShot/` it
tests the live site instead. Unit tests (`tools/deploy/test`) cover the layout, the assembly, the dist checks and the
server's path handling.
