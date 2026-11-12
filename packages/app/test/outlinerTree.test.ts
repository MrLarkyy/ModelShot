import type { SceneDocument } from '@modelshot/scene';
import { describe, expect, it } from 'vitest';
import { MAX_SCENE_ROWS, matchRanges, outlinerRows } from '../src/panels/outlinerTree';

// root(0) > arm(1) > hand(2); root also holds mesh 0; mesh 1 is outside every group; node 3 is a second root with mesh 2.
const doc = {
  rootNodes: [0, 3],
  nodes: [
    { name: 'root', parent: -1, children: [1], meshes: [0] },
    { name: 'arm', parent: 0, children: [2], meshes: [] },
    { name: 'hand', parent: 1, children: [], meshes: [] },
    { name: 'tail', parent: -1, children: [], meshes: [2] },
  ],
  meshes: [
    { name: 'torso', node: 0 },
    { name: 'loose', node: -1 },
    { name: 'fur', node: 3 },
  ],
} as unknown as SceneDocument;
const names = new Map<string, string>();
const label = (rows: ReturnType<typeof outlinerRows>): string[] =>
  rows.rows.map((r) => `${'-'.repeat(r.depth)}${r.kind === 'node' ? 'n' : 'm'}${r.index}`);

describe('outlinerRows', () => {
  it('lists groups, sub-groups and elements in order with their depth, loose elements last', () => {
    const out = outlinerRows(doc, names, new Set(), '', null);
    expect(label(out)).toEqual(['n0', '-n1', '--n2', '-m0', 'n3', '-m2', 'm1']);
    expect(out.total).toBe(7);
    expect(out.rows[1]).toMatchObject({ hasChildren: true, expanded: true });
    expect(out.rows[2]).toMatchObject({ hasChildren: false, expanded: false });
  });

  it('hides what lies below a collapsed group and marks it closed', () => {
    const out = outlinerRows(doc, names, new Set([0]), '', null);
    expect(label(out)).toEqual(['n0', 'n3', '-m2', 'm1']);
    expect(out.rows[0]).toMatchObject({ hasChildren: true, expanded: false });
    expect(out.total).toBe(4);
  });

  it('flags the groups above the selection, for an element and for a group', () => {
    const element = outlinerRows(doc, names, new Set(), '', { kind: 'mesh', index: 2 });
    expect(element.rows.filter((r) => r.ancestorOfSelected).map((r) => r.index)).toEqual([3]);
    const group = outlinerRows(doc, names, new Set(), '', { kind: 'node', index: 2 });
    expect(group.rows.filter((r) => r.ancestorOfSelected).map((r) => r.index)).toEqual([0, 1]);
  });

  it('with a search keeps the matches and the groups above them open, leaving the collapse alone', () => {
    const collapsed = new Set([0, 1]);
    const out = outlinerRows(doc, names, collapsed, 'HAND', null);
    expect(label(out)).toEqual(['n0', '-n1', '--n2']);
    expect(out.rows[0]?.expanded).toBe(true);
    expect(out.rows[1]?.expanded).toBe(true);
    expect(out.rows[2]?.matchRanges).toEqual([[0, 4]]);
    expect([...collapsed]).toEqual([0, 1]);
    expect(label(outlinerRows(doc, names, collapsed, '', null))).toEqual(['n0', 'n3', '-m2', 'm1']);
  });

  it('matches a user label and reports every range', () => {
    const renamed = new Map([['m:1', 'Banana band']]);
    const out = outlinerRows(doc, renamed, new Set(), 'an', null);
    expect(label(out)).toEqual(['n0', '-n1', '--n2', 'm1']);
    expect(out.rows.at(-1)?.matchRanges).toEqual([
      [1, 3],
      [3, 5],
    ]);
    expect(matchRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(matchRanges('abc', '')).toEqual([]);
  });

  it('caps the rows and still counts the visible ones', () => {
    const out = outlinerRows(doc, names, new Set(), '', null, 3);
    expect(out.shown).toBe(3);
    expect(out.total).toBe(7);
    expect(MAX_SCENE_ROWS).toBe(500);
  });

  it('survives a 5000-node chain without recursion and in bounded work', () => {
    const count = 5000;
    const chain = {
      rootNodes: [0],
      nodes: Array.from({ length: count }, (_, i) => ({
        name: `n${i}`,
        parent: i - 1,
        children: i + 1 < count ? [i + 1] : [],
        meshes: [],
      })),
      meshes: [],
    } as unknown as SceneDocument;
    const started = process.cpuUsage();
    const out = outlinerRows(chain, names, new Set(), '', { kind: 'node', index: count - 1 });
    const used = process.cpuUsage(started);
    expect(out.total).toBe(count);
    expect(out.shown).toBe(MAX_SCENE_ROWS);
    expect((used.user + used.system) / 1000).toBeLessThan(500);
  });

  it('ignores a cycle or an index outside the document', () => {
    const odd = {
      rootNodes: [0, 9],
      nodes: [{ name: 'a', parent: -1, children: [0, 7], meshes: [5] }],
      meshes: [],
    } as unknown as SceneDocument;
    expect(label(outlinerRows(odd, names, new Set(), '', null))).toEqual(['n0']);
  });
});
