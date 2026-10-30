import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../playwright.config';

const projects = config.projects ?? [];
const matchesTag = (pattern: RegExp | RegExp[] | undefined): boolean =>
  [pattern ?? []].flat().some((regExp) => regExp.test('title @timing'));

describe('playwright config projects', () => {
  it('keeps every @timing test out of every project but bench', () => {
    for (const project of projects.filter((p) => p.name !== 'bench')) {
      expect(matchesTag(project.grepInvert), project.name).toBe(true);
    }
  });

  it('runs the @timing tests in bench alone, with one worker and its own output directory', () => {
    const bench = projects.find((p) => p.name === 'bench');
    expect(bench?.grep).toSatisfy((grep: RegExp) => grep.test('title @timing'));
    expect(bench?.workers).toBe(1);
    expect(bench?.outputDir).toMatch(/test-results\/serial$/);
  });

  it('lists the projects with the longest tests first, so phase 1 does not end on one long test', () => {
    expect(projects.map((p) => p.name)).toEqual(['pair', 'bake', 'golden-pt', 'golden', 'bench']);
  });

  it('splits the bench project per test under --shard although it runs one worker', () => {
    const bench = projects.find((p) => p.name === 'bench');
    expect(bench?.fullyParallel).toBe(true);
    expect(bench?.workers).toBe(1);
  });

  it('has no project dependency', () => {
    for (const project of projects) expect(project.dependencies, project.name).toBeUndefined();
  });
});

describe('playwright config globalTimeout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const load = async (ci: string) => {
    vi.stubEnv('CI', ci);
    vi.resetModules();
    return (await import('../playwright.config')).default;
  };

  it('ends a CI run at 17 minutes, before the 20-minute job limit cancels it', async () => {
    expect((await load('true')).globalTimeout).toBe(17 * 60_000);
  });

  it('sets no global limit locally', async () => {
    expect((await load('')).globalTimeout).toBe(0);
  });
});
