import { createServer } from 'node:net';
import {
  FRAME_ORIGIN,
  HOST_ORIGIN,
  addViewer,
  expect,
  frameAlert,
  hostRequests,
  openHost,
  test,
  viewerFrame,
  waitForEvent,
} from './embedTest';

/** A local port nothing listens on: bound by the OS, then released. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

test('a model host without Access-Control-Allow-Origin is explained as CORS, naming both origins and the header', async ({
  page,
  request,
}) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/nocors/single-cube.bbmodel`, loading: 'eager' });
  const alert = await frameAlert(viewerFrame(page));
  expect(alert).toMatch(/^MODEL_CORS_BLOCKED: /);
  expect(alert).toContain(HOST_ORIGIN);
  expect(alert).toContain(FRAME_ORIGIN);
  expect(alert).toContain('Access-Control-Allow-Origin');
  const event = await waitForEvent(page, 'error');
  expect(event.detail.code).toBe('MODEL_CORS_BLOCKED');
  // The download and one HEAD probe, both without cookie or referrer.
  const asked = (await hostRequests(request)).filter((r) => r.path.startsWith('/nocors/'));
  expect(asked.map((r) => r.method)).toEqual(['GET', 'HEAD']);
  for (const r of asked) expect([r.cookie, r.referer]).toEqual([null, null]);
});

test('the same with nosniff and a JSON type is still explained as CORS (or names the missing header)', async ({
  page,
}) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/nocors-nosniff/single-cube.bbmodel`, loading: 'eager' });
  const alert = await frameAlert(viewerFrame(page));
  expect(alert).toMatch(/^MODEL_CORS_BLOCKED: /);
  expect(alert).toContain('Access-Control-Allow-Origin');
});

test('a host that does not answer is unreachable, not CORS', async ({ page }) => {
  await openHost(page);
  const port = await closedPort();
  await addViewer(page, { model: `http://127.0.0.1:${port}/model.bbmodel`, loading: 'eager' });
  expect(await frameAlert(viewerFrame(page))).toMatch(/^MODEL_UNREACHABLE: /);
  expect((await waitForEvent(page, 'error')).detail.code).toBe('MODEL_UNREACHABLE');
});

test('an error status is named', async ({ page }) => {
  await openHost(page);
  await addViewer(page, { model: `${HOST_ORIGIN}/status/404.bbmodel`, loading: 'eager' });
  const alert = await frameAlert(viewerFrame(page));
  expect(alert).toMatch(/^MODEL_HTTP_ERROR: /);
  expect(alert).toContain('404');
});
