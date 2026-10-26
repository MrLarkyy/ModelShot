import { createServer, type Server } from 'node:http';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Host page</title>
  </head>
  <body>
    <h1>A page that embeds a model</h1>
  </body>
</html>
`;

/** A page on another origin than the site, where a wiki or marketplace would put the viewer: /host.html. */
export function createHostServer(): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/host.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : PAGE);
    } else {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
}
