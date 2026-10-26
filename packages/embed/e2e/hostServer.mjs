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
//   /__requests      what was asked of this server (method, path, Cookie, Referer, Origin); ?clear=1 empties it
// Usage: node e2e/hostServer.mjs --port <port>
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
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
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
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
