import { describe, expect, it } from 'vitest';
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

  it('has no project dependency', () => {
    for (const project of projects) expect(project.dependencies, project.name).toBeUndefined();
  });
});
