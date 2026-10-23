export interface ServiceWorkerBuild {
  /** Changes with any byte of any listed file, so the browser installs the new worker and a new cache. */
  readonly version: string;
  /** Files of the build, relative to the worker's own folder. */
  readonly files: readonly string[];
}

// The worker as source text for the build plugin. It is fixed code: only the version and the file list, both from the
// build and JSON-encoded, are put into it. It only ever serves the app's own files and touches nothing else.
export function serviceWorkerSource(build: ServiceWorkerBuild): string {
  return `'use strict';
const PREFIX = 'modelshot-app-';
const CACHE = PREFIX + ${JSON.stringify(build.version)};
const FILES = ${JSON.stringify(build.files)};

self.addEventListener('install', (event) => {
  // Cache mode reload skips the HTTP cache: an update inside the page's max-age must not pin the old index.html next to new chunks.
  // The new worker waits for the open tabs to close: they hold the old file names, which the new cache no longer has.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((file) => new Request(new URL(file, self.registration.scope).href, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, { ignoreSearch: request.mode === 'navigate', ignoreVary: true }))
      .then((hit) => hit || fetch(request)),
  );
});
`;
}
