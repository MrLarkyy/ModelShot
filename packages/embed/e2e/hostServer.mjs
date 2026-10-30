// The host pages and the model host of the embed browser tests: another origin than the embed build. Serves
// e2e/host/{host,markup}.html (markup.html has the element in its markup before the script loads) and the test models in place (their licences stay next to them; nothing is copied):
//   /cors/<file>      a fixture with Access-Control-Allow-Origin: *
//   /nocors/<file>    the same without it
//   /nocors-nosniff/<file>   the same without it and with X-Content-Type-Options: nosniff (opaque-response blocking)
//   /cors/not-json.bbmodel   a model the loader refuses
//   /status/404.bbmodel      a 404 with CORS
//   /big-length.bbmodel      65 MiB declared in Content-Length, then zeros until the client stops
//   /big-stream.bbmodel      zeros without Content-Length until the client stops
//   /stall.bbmodel           headers, then nothing
//   /sidecars/<path>         a file of e2e/fixtures/sidecars (a model and the files it refers to), with CORS; any other
//                            path under it a 404 with CORS
//   /sidecars-partial/<path> the same, the .png files without Access-Control-Allow-Origin
//   /hostile/<case>          a model referring to a file the embed must refuse, after one it may download:
//                            absolute.gltf (another origin), protocol-relative.gltf, backslash.gltf, javascript.gltf,
//                            file.gltf, data-mtllib.obj; many.gltf refers to 32 images;
//                            missing-mtllib.obj refers to a material library that answers 404 (it still shows)
//   /mainthread/<case>       large glTF models made in memory on first request, for the frame's main-thread budget:
//                            big.gltf (63 MiB of JSON with the fixture's buffer and image), long-uri.gltf (an image uri
//                            of 60 MiB after a fetchable buffer), duplicates.gltf (one image uri 100 000 times)
//   /__requests      what was asked of this server (method, path, Cookie, Referer, Origin); ?clear=1 empties it
// Usage: node e2e/hostServer.mjs --port <port>
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const MODEL_DIRS = [
  join(REPO, 'packages', 'formats', 'test', 'fixtures', 'bbmodel'),
  join(REPO, 'packages', 'formats', 'test', 'fixtures', 'gltf'),
  join(REPO, 'packages', 'formats', 'test', 'fixtures', 'obj'),
  join(REPO, 'packages', 'formats', 'test', 'fixtures', 'skins'),
  join(REPO, 'tools', 'harness', 'fixtures', 'models'),
];
const MODEL_TYPES = {
  '.bbmodel': 'application/json',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.obj': 'text/plain',
  '.png': 'image/png',
};
const SIDECAR_DIR = join(HERE, 'fixtures', 'sidecars');
const SIDECAR_TYPES = { ...MODEL_TYPES, '.bin': 'application/octet-stream', '.mtl': 'text/plain' };
const MIB = 1024 * 1024;
const BIG_BYTES = 65 * MIB;

/** File name -> path, the first directory holding it; only model files, so no other path can be asked for. */
const models = new Map();
for (const dir of MODEL_DIRS) {
  for (const name of readdirSync(dir)) {
    if (extname(name) in MODEL_TYPES && !models.has(name)) models.set(name, join(dir, name));
  }
}

const portIndex = process.argv.indexOf('--port');
const port = Number(process.argv[portIndex + 1]);
if (portIndex < 0 || !Number.isInteger(port)) throw new Error('usage: node e2e/hostServer.mjs --port <port>');

const log = [];

/** The models of `/hostile/<case>`: the fixture glTF with its buffer kept and its image replaced. */
function hostileModels() {
  const scene = JSON.parse(readFileSync(join(SIDECAR_DIR, 'gltf', 'scene.gltf'), 'utf8'));
  const gltf = (images) =>
    JSON.stringify({
      ...scene,
      buffers: [{ ...scene.buffers[0], uri: '../sidecars/gltf/bin/scene.bin' }],
      images: images.map((uri) => ({ uri })),
    });
  const other = `http://localhost:${port}/sidecars/textures/checker%20tile.png`;
  return new Map([
    ['absolute.gltf', gltf([other])],
    ['protocol-relative.gltf', gltf([`//localhost:${port}/sidecars/textures/checker%20tile.png`])],
    ['backslash.gltf', gltf([`/\\localhost:${port}/sidecars/textures/checker%20tile.png`])],
    ['javascript.gltf', gltf(['javascript:alert(1)//a.png'])],
    ['file.gltf', gltf(['file:///etc/passwd'])],
    [
      'data-mtllib.obj',
      ['mtllib ../sidecars/obj/scene.mtl', 'mtllib data:text/plain,newmtl%20a', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0'].join(
        '\n',
      ),
    ],
    [
      'missing-mtllib.obj',
      ['mtllib ../sidecars/obj/gone.mtl', 'usemtl a', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'),
    ],
    ['many.gltf', gltf(Array.from({ length: 32 }, (_, i) => `../sidecars/t${i}.png`))],
  ]);
}
const hostile = hostileModels();

/**
 * The fixture glTF with its files relative to `/mainthread/`, and `extra` merged in. Made here rather than committed:
 * too large for the repository, and it is the fixture (its licence) padded.
 */
function mainThreadGltf(extra) {
  const scene = JSON.parse(readFileSync(join(SIDECAR_DIR, 'gltf', 'scene.gltf'), 'utf8'));
  return JSON.stringify({
    ...scene,
    buffers: [{ ...scene.buffers[0], uri: '../sidecars/gltf/bin/scene.bin' }],
    images: [{ uri: '../sidecars/textures/checker%20tile.png' }],
    ...extra,
  });
}

const MAIN_THREAD_MODELS = {
  // Numbers, so that parsing the JSON costs what a model's own arrays would.
  'big.gltf': () => {
    const json = mainThreadGltf({ extras: { padding: [] } });
    const count = Math.floor((63 * MIB - json.length) / 9);
    return json.replace('"padding":[]', `"padding":[${'0.123456,'.repeat(count - 1)}0.123456]`);
  },
  'long-uri.gltf': () =>
    mainThreadGltf({
      images: [{ uri: '../sidecars/textures/checker%20tile.png' }, { uri: `${'a'.repeat(60 * MIB)}.png` }],
    }),
  'duplicates.gltf': () =>
    mainThreadGltf({
      images: Array.from({ length: 100_000 }, () => ({ uri: '../sidecars/textures/checker%20tile.png' })),
    }),
};
const mainThreadModels = new Map();

/** The file of `/sidecars/<path>` inside the fixture directory, or null: a path never leaves it. */
function sidecarFile(path) {
  let relative;
  try {
    relative = decodeURIComponent(path);
  } catch {
    return null;
  }
  const file = resolve(SIDECAR_DIR, relative);
  if (!file.startsWith(SIDECAR_DIR + sep) || !(extname(file) in SIDECAR_TYPES)) return null;
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function zeros(response) {
  const chunk = Buffer.alloc(MIB);
  let sent = 0;
  const write = () => {
    while (sent < BIG_BYTES && !response.destroyed) {
      sent += chunk.length;
      if (!response.write(chunk)) {
        response.once('drain', write);
        return;
      }
    }
    response.end();
  };
  write();
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const path = url.pathname;
  if (path === '/__requests') {
    // Closed after each answer: the test client would otherwise reuse a connection that Node's 5 s keep-alive timeout
    // closes in the same instant (ECONNRESET), which a test idle for a few seconds before asking runs into.
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
    response.end(JSON.stringify(log));
    if (url.searchParams.get('clear') === '1') log.length = 0;
    return;
  }
  log.push({
    method: request.method,
    path: url.pathname + url.search,
    cookie: request.headers.cookie ?? null,
    referer: request.headers.referer ?? null,
    origin: request.headers.origin ?? null,
  });
  response.on('error', () => undefined);
  const head = request.method === 'HEAD';
  const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };

  if (path === '/host.html' || path === '/markup.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    if (head) response.end();
    else createReadStream(join(HERE, 'host', path.slice(1))).pipe(response);
    return;
  }
  if (path === '/cors/not-json.bbmodel') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' });
    response.end(head ? undefined : 'this is not a model');
    return;
  }
  if (path === '/status/404.bbmodel') {
    response.writeHead(404, { ...cors, 'content-type': 'text/plain' });
    response.end(head ? undefined : 'not here');
    return;
  }
  if (path === '/big-length.bbmodel' || path === '/big-stream.bbmodel') {
    const length = path === '/big-length.bbmodel' ? { 'content-length': String(BIG_BYTES) } : {};
    response.writeHead(200, { ...cors, 'content-type': 'application/json', ...length });
    if (head) response.end();
    else zeros(response);
    return;
  }
  if (path === '/stall.bbmodel') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' });
    response.flushHeaders();
    if (head) response.end();
    return;
  }
  const sidecar = /^\/(sidecars|sidecars-partial)\/(.+)$/.exec(path);
  const sidecarPath = sidecar ? sidecarFile(sidecar[2]) : null;
  if (sidecar && sidecarPath) {
    const withheld = sidecar[1] === 'sidecars-partial' && extname(sidecarPath) === '.png';
    response.writeHead(200, {
      ...(withheld ? { 'cache-control': 'no-store' } : cors),
      'content-type': SIDECAR_TYPES[extname(sidecarPath)],
      'content-length': String(statSync(sidecarPath).size),
    });
    if (head) response.end();
    else createReadStream(sidecarPath).pipe(response);
    return;
  }
  if (sidecar) {
    response.writeHead(404, { ...cors, 'content-type': 'text/plain' });
    response.end(head ? undefined : 'not here');
    return;
  }
  const hostileCase = /^\/hostile\/([^/]+)$/.exec(path);
  const hostileModel = hostileCase ? hostile.get(hostileCase[1]) : undefined;
  if (hostileModel !== undefined) {
    response.writeHead(200, { ...cors, 'content-type': MODEL_TYPES[extname(path)] });
    response.end(head ? undefined : hostileModel);
    return;
  }
  const mainThreadCase = /^\/mainthread\/([^/]+)$/.exec(path)?.[1];
  if (mainThreadCase !== undefined && Object.hasOwn(MAIN_THREAD_MODELS, mainThreadCase)) {
    if (!mainThreadModels.has(mainThreadCase)) {
      mainThreadModels.set(mainThreadCase, Buffer.from(MAIN_THREAD_MODELS[mainThreadCase](), 'utf8'));
    }
    const body = mainThreadModels.get(mainThreadCase);
    response.writeHead(200, { ...cors, 'content-type': MODEL_TYPES['.gltf'], 'content-length': String(body.length) });
    response.end(head ? undefined : body);
    return;
  }
  const match = /^\/(cors|nocors|nocors-nosniff)\/([^/]+)$/.exec(path);
  const file = match ? models.get(decodeURIComponent(match[2])) : undefined;
  if (match && file) {
    response.writeHead(200, {
      ...(match[1] === 'cors' ? cors : { 'cache-control': 'no-store' }),
      ...(match[1] === 'nocors-nosniff' ? { 'x-content-type-options': 'nosniff' } : {}),
      'content-type': MODEL_TYPES[extname(file)],
      'content-length': String(statSync(file).size),
    });
    if (head) response.end();
    else createReadStream(file).pipe(response);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('not found');
});

server.listen(port, '127.0.0.1');
