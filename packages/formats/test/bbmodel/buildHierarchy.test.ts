import { describe, expect, it } from 'vitest';
import { buildHierarchy } from '../../src/bbmodel/buildHierarchy';
import { DEFAULT_BBMODEL_LIMITS } from '../../src/bbmodel/BbmodelLoadOptions';
import { BbmodelWarningList } from '../../src/bbmodel/BbmodelWarning';
import type { JsonObject } from '../../src/bbmodel/JsonFields';

const ids = new Map([
  ['a', 0],
  ['b', 1],
  ['c', 2],
]);

function build(root: JsonObject) {
  const warnings = new BbmodelWarningList();
  return { ...buildHierarchy(root, ids, 3, DEFAULT_BBMODEL_LIMITS, warnings), warnings: warnings.items };
}

const format4 = {
  outliner: [
    {
      name: 'root',
      uuid: 'g1',
      origin: [0, 8, 0],
      rotation: [0, 45, 0],
      children: ['a', { name: 'leaf', uuid: 'g2', origin: [1, 2, 3], visibility: false, children: ['b'] }],
    },
  ],
};

const format5 = {
  groups: [
    { name: 'leaf', uuid: 'g2', origin: [1, 2, 3], visibility: false },
    { name: 'root', uuid: 'g1', origin: [0, 8, 0], rotation: [0, 45, 0] },
  ],
  outliner: [{ uuid: 'g1', isOpen: true, children: ['a', { uuid: 'g2', isOpen: false, children: ['b'] }] }],
};

describe('buildHierarchy', () => {
  it('format 4.x inline groups and 5.x groups give the same tree', () => {
    const four = build(format4);
    const five = build(format5);
    expect(five.nodes).toEqual(four.nodes);
    expect(five.placements).toEqual(four.placements);
    expect(four.nodes).toEqual([
      {
        name: 'root',
        sourceId: 'g1',
        parent: -1,
        children: [1],
        pivot: [0, 8, 0],
        rotation: [0, 45, 0],
        visible: true,
      },
      { name: 'leaf', sourceId: 'g2', parent: 0, children: [], pivot: [1, 2, 3], rotation: [0, 0, 0], visible: false },
    ]);
  });

  it('places elements in outliner order, then unreferenced ones at the root in file order', () => {
    expect(build(format4).placements).toEqual([
      { element: 0, node: 0 },
      { element: 1, node: 1 },
      { element: 2, node: -1 },
    ]);
    expect(build({}).placements).toEqual([
      { element: 0, node: -1 },
      { element: 1, node: -1 },
      { element: 2, node: -1 },
    ]);
  });

  it('skips an unknown uuid with a warning', () => {
    const { placements, warnings } = build({ outliner: ['a', 'nope', 'b'] });
    expect(placements.map((p) => p.element)).toEqual([0, 1, 2]);
    expect(warnings.map((w) => [w.code, w.path])).toEqual([['UNKNOWN_REFERENCE', '$.outliner[1]']]);
    expect(warnings[0]?.message).toContain('"nope"');
  });

  it('keeps sibling order with deep trees and many roots', () => {
    const { nodes, rootNodes } = build({
      outliner: [
        { name: 'r1', children: [{ name: 'r1a' }, { name: 'r1b', children: [{ name: 'r1b1' }] }] },
        { name: 'r2' },
      ],
    });
    expect(nodes.map((n) => [n.name, n.parent])).toEqual([
      ['r1', -1],
      ['r1a', 0],
      ['r1b', 0],
      ['r1b1', 2],
      ['r2', -1],
    ]);
    expect(rootNodes).toEqual([0, 4]);
    expect(nodes[0]?.children).toEqual([1, 2]);
  });
});
