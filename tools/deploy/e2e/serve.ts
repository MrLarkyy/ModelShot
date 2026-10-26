import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployPorts } from './deployPort.ts';
import { createHostServer } from './hostServer.ts';
import { createStaticServer, listen } from './staticServer.ts';

// The servers of the deploy suite: the assembled dist under /ModelShot/ and the host page on another port. With
// --host-only (the live run) only the host page, since the site is the deployed one.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ports = deployPorts();

if (!process.argv.includes('--host-only') && !existsSync(join(dist, 'index.html'))) {
  console.error(`deploy: ${dist} has no site: run "pnpm -r build" first`);
  process.exit(1);
}

if (!process.argv.includes('--host-only')) await listen(createStaticServer(dist, '/ModelShot/'), ports.site);
await listen(createHostServer(), ports.host);
