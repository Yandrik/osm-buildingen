import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES,
  type BuildingInput,
  type BuildingMesh,
  ROOF_SHAPES,
  type Vec2,
  generateBuilding,
} from '../src';

const rect = (w: number, d: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];
const L: Vec2[] = [
  [0, 0],
  [12, 0],
  [12, 6],
  [6, 6],
  [6, 11],
  [0, 11],
];

function checkMesh(mesh: BuildingMesh): void {
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.colors.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.indices.length).toBeGreaterThan(0);
  const vertices = mesh.positions.length / 3;
  for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
  for (const i of mesh.indices) expect(i).toBeLessThan(vertices);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    expect(Math.abs(l - 1)).toBeLessThan(1e-3);
  }
}

const base = (over: Partial<BuildingInput> = {}): BuildingInput => ({
  footprint: { outer: rect(10, 8) },
  style: { region: 'de', modernity: 0.5 },
  seed: 'test',
  ...over,
});

describe('generateBuilding', () => {
  it('builds every type', () => {
    for (const type of BUILDING_TYPES) {
      for (const modernity of [0, 0.5, 1]) {
        const mesh = generateBuilding(
          base({ type, style: { region: 'de', modernity }, seed: `${type}-${modernity}`, debug: true }),
        );
        checkMesh(mesh);
        expect(mesh.debug?.facade?.fallback).toBe(false);
      }
    }
  });

  it('builds every roof shape on a rectangle and an L', () => {
    for (const shape of ROOF_SHAPES) {
      for (const outer of [rect(10, 8), L])
        checkMesh(generateBuilding(base({ footprint: { outer }, roof: { shape } })));
    }
  });

  it('is deterministic and seed dependent', () => {
    const a = generateBuilding(base());
    const b = generateBuilding(base());
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
    const c = generateBuilding(base({ seed: 'other' }));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
  });

  it('respects given height and levels', () => {
    const mesh = generateBuilding(base({ height: 12, levels: 3, roof: { shape: 'flat' }, debug: true }));
    expect(mesh.debug?.spec.levelHeights.length).toBe(3);
    expect(mesh.debug?.spec.wallHeight).toBeCloseTo(12, 2);
    const gabled = generateBuilding(base({ height: 12, roof: { shape: 'gabled', height: 4 } }));
    expect(gabled.bounds.max[1]).toBeCloseTo(12, 1);
  });

  it('keeps openings off blocked walls', () => {
    // Neighbour 0.5 m south of the south wall (wall 0 of the rectangle).
    const neighbour = {
      footprint: {
        outer: [
          [0, -8.5],
          [10, -8.5],
          [10, -0.5],
          [0, -0.5],
        ] as Vec2[],
      },
    };
    for (let s = 0; s < 20; s++) {
      const mesh = generateBuilding(base({ neighbours: [neighbour], seed: s, debug: true }));
      for (const cell of mesh.debug?.facade?.cells ?? []) {
        if (cell.wall === 0) expect(cell.tile).toBe('blank');
      }
    }
  });

  it('puts the door on the wall facing the road', () => {
    const road = {
      line: [
        [-20, 20],
        [30, 20],
      ] as Vec2[],
    }; // north of the building
    const mesh = generateBuilding(base({ roads: [road], debug: true }));
    const door = mesh.debug?.facade?.cells.find((c) => c.tile === 'door');
    expect(door?.wall).toBe(2); // north wall of a CCW rectangle
  });

  it('gives house and garage of one plot the same wall colour', () => {
    const house = generateBuilding(base({ groupKey: 'plot-1', type: 'house', seed: 1, debug: true }));
    const garage = generateBuilding(
      base({ groupKey: 'plot-1', type: 'garage', seed: 2, footprint: { outer: rect(3, 6) }, debug: true }),
    );
    expect(garage.debug?.spec.palette.wall).toBe(house.debug?.spec.palette.wall);
  });

  it('handles courtyards and massing detail', () => {
    const hole: Vec2[] = [
      [5, 5],
      [15, 5],
      [15, 13],
      [5, 13],
    ];
    checkMesh(
      generateBuilding(base({ footprint: { outer: rect(20, 18), holes: [hole] }, type: 'apartments' })),
    );
    checkMesh(generateBuilding(base({ detail: 'massing' })));
  });
});
