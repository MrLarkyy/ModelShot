import { createReadStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname } from 'node:path';
import { resolveStaticPath } from './staticPath.ts';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * `root` served under `prefix` the way GitHub Pages serves a project site: MIME types by extension,
 * Access-Control-Allow-Origin *, max-age 600, no framing or CSP headers, a directory without its slash redirected.
 * Listens on 127.0.0.1 only.
 */
export function createStaticServer(root: string, prefix: string): Server {
  return createServer((request, response) => {
    response.on('error', () => undefined);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const raw = request.url ?? '/';
    const queryAt = raw.indexOf('?');
    const resolved = resolveStaticPath(root, prefix, queryAt < 0 ? raw : raw.slice(0, queryAt));
    const query = queryAt < 0 ? '' : raw.slice(queryAt);
    if (resolved.kind === 'badRequest') {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('bad request');
    } else if (resolved.kind === 'notFound') {
      response.writeHead(404, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      response.end('not found');
    } else if (resolved.kind === 'redirect') {
      response.writeHead(301, { location: resolved.location + query });
      response.end();
    } else {
      response.writeHead(200, {
        'content-type': TYPES[extname(resolved.path).toLowerCase()] ?? 'application/octet-stream',
        'access-control-allow-origin': '*',
        'cache-control': 'max-age=600',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(resolved.path).pipe(response);
    }
  });
}

export function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}
