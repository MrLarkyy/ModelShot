import {
  CUBE,
  FRAME_ORIGIN,
  HOST_ORIGIN,
  addViewer,
  cspViolations,
  expect,
  hostRequests,
  openHost,
  test,
  viewerFrame,
  waitLit,
} from './embedTest';

test('the embed sends nothing but body-less GETs, the parameters never reach a server, the model host learns no page', async ({
  page,
  seen,
  request,
  context,
}) => {
  await context.addCookies([{ name: 'session', value: 'secret', url: HOST_ORIGIN }]);
  await openHost(page);
  await addViewer(page, { model: CUBE, look: 'rim', yaw: '180', autorotate: '', background: '#1b2a4a' });
  await waitLit(viewerFrame(page));

  for (const r of seen) {
    const url = new URL(r.url);
    if (url.protocol === 'blob:' || url.protocol === 'data:') continue;
    expect([HOST_ORIGIN, FRAME_ORIGIN], `${r.url}: no third origin`).toContain(url.origin);
    expect(r.method, r.url).toBe('GET');
    expect(r.body, r.url).toBeNull();
    if (url.origin === FRAME_ORIGIN) {
      expect(url.search, `${r.url}: no query to the embed server`).toBe('');
      // What reaches the server: a fragment, where the parameters are, is never sent.
      const sent = `${url.origin}${url.pathname}${url.search}`;
      expect(sent, 'no parameter in a request to the embed server').not.toMatch(/single-cube|1b2a4a|model=|look=/);
      expect(url.pathname, 'no export code in the embed').not.toMatch(/export|encode|webm|gif/i);
    }
  }
  // The model URL is asked for once, by the frame.
  expect(seen.filter((r) => new URL(r.url).pathname.includes('single-cube')).map((r) => r.url)).toEqual([CUBE]);

  const asked = (await hostRequests(request)).filter((r) => r.path.includes('single-cube'));
  expect(asked).toEqual([
    { method: 'GET', path: '/cors/single-cube.bbmodel', cookie: null, referer: null, origin: FRAME_ORIGIN },
  ]);
  expect(await cspViolations(page)).toEqual([]);
});
