import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { openFixture } from '../src/expectGolden';

const info = {
  renderer: 'ANGLE (SwiftShader)',
  floatRenderTargets: true,
  width: 1,
  height: 1,
  samplesDone: 1,
  rgba: '',
};

function stubPage(bootFailures: number): { page: Page; calls: string[] } {
  const calls: string[] = [];
  let failures = bootFailures;
  const page = {
    on: () => page,
    off: () => page,
    goto: () => Promise.resolve(void calls.push('goto')),
    reload: () => Promise.resolve(void calls.push('reload')),
    waitForFunction: () => {
      calls.push('wait');
      return failures-- > 0 ? Promise.reject(new Error('timeout')) : Promise.resolve();
    },
    evaluate: () => Promise.resolve(info),
  };
  return { page: page as unknown as Page, calls };
}

describe('openFixture', () => {
  it('boots without a reload when the fixture is there', async () => {
    const { page, calls } = stubPage(0);
    await openFixture(page, '/pt.html');
    expect(calls).toEqual(['goto', 'wait']);
  });

  it('reloads once when the fixture module never ran', async () => {
    const { page, calls } = stubPage(1);
    await openFixture(page, '/pt.html');
    expect(calls).toEqual(['goto', 'wait', 'reload', 'wait']);
  });

  it('names the page after a second failure', async () => {
    const { page } = stubPage(2);
    await expect(openFixture(page, '/pt.html')).rejects.toThrow('did not boot after a reload');
  });
});
