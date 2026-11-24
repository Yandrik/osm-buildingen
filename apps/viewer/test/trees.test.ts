import { type OsmData, createProjection } from '@osm-buildingen/osm';
import { describe, expect, it } from 'vitest';
import { FOREST_STEP, osmTrees } from '../src/trees';

const origin = { lat: 48.4, lon: 10 };
const proj = createProjection(origin);

/** Node at local metres (x east, y north). */
function node(id: number, x: number, y: number, tags?: Record<string, string>): OsmData['nodes'][number] {
  const ll = proj.unproject(x, y);
  return tags ? { id, lat: ll.lat, lon: ll.lon, tags } : { id, lat: ll.lat, lon: ll.lon };
}

const square = (first: number, x0: number, y0: number, size: number): OsmData['nodes'] => [
  node(first, x0, y0),
  node(first + 1, x0 + size, y0),
  node(first + 2, x0 + size, y0 + size),
  node(first + 3, x0, y0 + size),
];

function points(set: { points: Float32Array }): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < set.points.length; i += 3)
    out.push([set.points[i] as number, set.points[i + 1] as number]);
  return out;
}

describe('osmTrees', () => {
  it('places mapped trees and spaces tree rows', () => {
    const data: OsmData = {
      nodes: [node(1, 5, 5, { natural: 'tree' }), node(2, 0, 50), node(3, 40, 50)],
      ways: [{ id: 10, nodes: [2, 3], tags: { natural: 'tree_row' } }],
      relations: [],
    };
    const trees = osmTrees(data, proj, undefined);
    expect(trees.mapped).toBe(1 + 6); // 0, 8, …, 40
    expect(trees.filled).toBe(0);
    const [x, y] = points(trees)[0] as [number, number];
    expect(x).toBeCloseTo(5, 3);
    expect(y).toBeCloseTo(5, 3);
  });

  it('fills a forest at about one tree per cell, inside only, and the same way every time', () => {
    const data: OsmData = {
      nodes: square(1, 0, 0, 220),
      ways: [{ id: 10, nodes: [1, 2, 3, 4, 1], tags: { landuse: 'forest' } }],
      relations: [],
    };
    const a = osmTrees(data, proj, undefined);
    const cells = (220 / FOREST_STEP) ** 2;
    expect(a.filled).toBeGreaterThan(cells * 0.9);
    expect(a.filled).toBeLessThan(cells * 1.1);
    for (const [x, y] of points(a)) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(220.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(220.01);
    }
    expect(osmTrees(data, proj, undefined).points).toEqual(a.points);
  });

  it('leaves holes of multipolygons empty, with members in any order and direction', () => {
    const data: OsmData = {
      nodes: [...square(1, 0, 0, 200), ...square(11, 60, 60, 80)],
      ways: [
        // Outer ring split into two open ways, one reversed.
        { id: 20, nodes: [1, 2, 3], tags: {} },
        { id: 21, nodes: [1, 4, 3], tags: {} },
        { id: 22, nodes: [11, 12, 13, 14, 11], tags: {} },
      ],
      relations: [
        {
          id: 30,
          tags: { type: 'multipolygon', natural: 'wood' },
          members: [
            { type: 'way', ref: 22, role: 'inner' },
            { type: 'way', ref: 21, role: 'outer' },
            { type: 'way', ref: 20, role: 'outer' },
          ],
        },
      ],
    };
    const trees = points(osmTrees(data, proj, undefined));
    expect(trees.length).toBeGreaterThan(200);
    const inHole = trees.filter(([x, y]) => x > 60.5 && x < 139.5 && y > 60.5 && y < 139.5);
    expect(inHole).toHaveLength(0);
  });

  it('skips incomplete multipolygons and does not double overlapping areas', () => {
    const data: OsmData = {
      nodes: square(1, 0, 0, 100),
      ways: [
        { id: 10, nodes: [1, 2, 3, 4, 1], tags: { landuse: 'forest' } },
        { id: 11, nodes: [1, 2, 3, 4, 1], tags: { natural: 'wood' } },
      ],
      relations: [
        {
          id: 30,
          tags: { type: 'multipolygon', landuse: 'forest' },
          members: [{ type: 'way', ref: 99, role: 'outer' }],
        },
      ],
    };
    const both = osmTrees(data, proj, undefined);
    const one = osmTrees({ ...data, ways: data.ways.slice(0, 1), relations: [] }, proj, undefined);
    expect(both.filled).toBe(one.filled);
  });

  it('clips to the given rectangle', () => {
    const data: OsmData = {
      nodes: [...square(1, 0, 0, 200), node(9, 300, 300, { natural: 'tree' })],
      ways: [{ id: 10, nodes: [1, 2, 3, 4, 1], tags: { landuse: 'forest' } }],
      relations: [],
    };
    const trees = osmTrees(data, proj, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(trees.mapped).toBe(0);
    for (const [x, y] of points(trees)) {
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});
