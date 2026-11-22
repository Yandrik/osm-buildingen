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
    // A chimney may stand a little above the ridge.
    expect(gabled.bounds.max[1]).toBeGreaterThan(11.95);
    expect(gabled.bounds.max[1]).toBeLessThan(13);
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

describe('parts, passages and entrances', () => {
  const part = (x: number, w: number, levels: number, minLevel = 0) => ({
    footprint: {
      outer: [
        [x, 0],
        [x + w, 0],
        [x + w, 10],
        [x, 10],
      ] as Vec2[],
    },
    levels,
    minLevel,
    roof: { shape: 'flat' as const },
  });

  it('builds parts instead of the outline, with one entrance and a shared palette', () => {
    const mesh = generateBuilding(
      base({
        type: 'office',
        footprint: { outer: rect(30, 10) },
        parts: [part(0, 18, 6), part(18, 12, 3)],
        debug: true,
      }),
    );
    checkMesh(mesh);
    const parts = mesh.debug?.parts ?? [];
    expect(parts.length).toBe(2);
    // Wall, roof and trim are plot-wide; the door colour is per part.
    for (const key of ['wall', 'roof', 'trim', 'frame'] as const) {
      expect(parts[0]?.spec.palette[key]).toBe(parts[1]?.spec.palette[key]);
    }
    expect(parts[0]?.spec.levelHeights.length).toBe(6);
    expect(parts[1]?.spec.levelHeights.length).toBe(3);
    const doors = parts.flatMap((p) => p.facade?.cells.filter((c) => c.role === 'door') ?? []);
    expect(doors.length).toBe(1);
    // The low part's wall towards the tall part is blocked over its whole height.
    const low = parts[1];
    const sharedWall =
      low?.walls.findIndex((w) => Math.abs(w.a[0] - 18) < 1e-6 && Math.abs(w.b[0] - 18) < 1e-6) ?? -1;
    expect(sharedWall).toBeGreaterThanOrEqual(0);
    for (const cell of low?.facade?.cells ?? [])
      if (cell.wall === sharedWall) expect(cell.role).toBe('blank');
  });

  it('lets a part start above the ground', () => {
    const mesh = generateBuilding(
      base({
        type: 'office',
        footprint: { outer: rect(18, 10) },
        parts: [part(0, 18, 4), part(4, 6, 6, 4)],
        debug: true,
      }),
    );
    checkMesh(mesh);
    const top = mesh.debug?.parts?.[1];
    expect(top?.spec.base).toBeGreaterThan(10);
    expect(top?.facade?.cells.some((c) => c.role === 'door')).toBe(false);
  });

  it('cuts an arch where a flagged road passes through', () => {
    const through = {
      line: [
        [15, -30],
        [15, 40],
      ] as Vec2[],
      width: 4,
      passage: true,
    };
    const mesh = generateBuilding(
      base({
        type: 'apartments',
        footprint: { outer: rect(30, 10) },
        roads: [through],
        levels: 3,
        debug: true,
      }),
    );
    checkMesh(mesh);
    const arches = mesh.debug?.facade?.cells.filter((c) => c.role === 'arch') ?? [];
    expect(arches.length).toBeGreaterThanOrEqual(2); // entry and exit wall
    expect(new Set(arches.map((c) => c.wall)).size).toBe(2);
    expect(arches.every((c) => c.row === 0)).toBe(true);
  });

  it('does not cut small buildings unless the road is flagged', () => {
    const crossing = {
      line: [
        [5, -30],
        [5, 40],
      ] as Vec2[],
    };
    const mesh = generateBuilding(base({ roads: [crossing], debug: true }));
    expect(mesh.debug?.facade?.cells.some((c) => c.role === 'arch')).toBe(false);
  });

  it('honours entrance: false', () => {
    const mesh = generateBuilding(base({ entrance: false, debug: true }));
    expect(mesh.debug?.facade?.cells.some((c) => c.role === 'door')).toBe(false);
    expect(mesh.debug?.facade?.streetWall).toBe(-1);
  });
});

describe('outline body and curved roofs', () => {
  const tower = { footprint: { outer: rect(4, 4) }, height: 30, roof: { shape: 'dome' as const, height: 3 } };
  const church = (parts: BuildingInput['parts']): BuildingInput =>
    base({
      footprint: { outer: rect(24, 10) },
      height: 14,
      roof: { shape: 'gabled', height: 5 },
      parts,
      detail: 'massing',
      debug: true,
    });
  const areaOf = (d: { spec: { metrics: { area: number } } }): number => d.spec.metrics.area;

  it('builds the part of the outline that no part covers', () => {
    const mesh = generateBuilding(church([tower]));
    checkMesh(mesh);
    const parts = mesh.debug?.parts ?? [];
    expect(parts.length).toBe(2);
    const body = parts[1];
    expect(body && areaOf(body)).toBeCloseTo(24 * 10 - 16, 1);
    expect(body?.spec.roof.shape).toBe('gabled');
    expect(body && body.spec.base + body.spec.wallHeight + body.spec.roof.height).toBeCloseTo(14, 2);
    expect(mesh.bounds.max[1]).toBeCloseTo(30, 1); // the tower still stands above it
  });

  it('adds no body when the parts cover the outline', () => {
    const halves = [
      { footprint: { outer: rect(12, 10) }, height: 10 },
      {
        footprint: {
          outer: [
            [12, 0],
            [24, 0],
            [24, 10],
            [12, 10],
          ] as Vec2[],
        },
        height: 16,
      },
    ];
    expect(generateBuilding(church(halves)).debug?.parts?.length).toBe(2);
  });

  it('ignores slivers left by imprecise parts', () => {
    const almost = [
      {
        footprint: {
          outer: [
            [0.15, 0.1],
            [23.9, 0.1],
            [23.9, 9.9],
            [0.15, 9.9],
          ] as Vec2[],
        },
        height: 12,
      },
    ];
    expect(generateBuilding(church(almost)).debug?.parts?.length).toBe(1);
  });

  it('keeps the body under a part that starts above it', () => {
    const turret = {
      footprint: {
        outer: [
          [10, 3],
          [14, 3],
          [14, 7],
          [10, 7],
        ] as Vec2[],
      },
      height: 22,
      minHeight: 12,
      roof: { shape: 'cone' as const, height: 6 },
    };
    const parts = generateBuilding(church([turret])).debug?.parts ?? [];
    expect(parts.length).toBe(2);
    expect(parts[1] && areaOf(parts[1])).toBeCloseTo(240, 1); // nothing cut out of the body
  });

  it('cuts the body around a tower standing inside it and keeps the tagged gable', () => {
    const inside = {
      footprint: {
        outer: [
          [10, 3],
          [14, 3],
          [14, 7],
          [10, 7],
        ] as Vec2[],
      },
      height: 30,
      roof: { shape: 'onion' as const },
    };
    const mesh = generateBuilding(church([inside]));
    checkMesh(mesh);
    const body = mesh.debug?.parts?.[1];
    expect(body?.spec.footprint.holes.length).toBe(1);
    expect(body?.spec.roof.shape).toBe('gabled');
  });

  it('builds dome, onion, cone and round roofs on round and square footprints', () => {
    const circle: Vec2[] = Array.from({ length: 16 }, (_, i) => [
      5 * Math.cos((i / 16) * 2 * Math.PI),
      5 * Math.sin((i / 16) * 2 * Math.PI),
    ]);
    for (const shape of ['dome', 'onion', 'cone', 'round'] as const) {
      for (const outer of [circle, rect(8, 8), rect(14, 6)]) {
        const mesh = generateBuilding(
          base({ footprint: { outer }, height: 20, roof: { shape, height: 6 }, debug: true }),
        );
        checkMesh(mesh);
        expect(mesh.debug?.spec.roof.shape).toBe(shape);
        expect(mesh.debug?.spec.notes).toEqual([]);
        expect(mesh.bounds.max[1]).toBeCloseTo(20, 1);
      }
    }
  });

  it('falls back to a skeleton roof when a dome cannot sit on the footprint', () => {
    // A U shape has no point that sees all of its edges from inside.
    const U: Vec2[] = [
      [0, 0],
      [14, 0],
      [14, 10],
      [10, 10],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    const mesh = generateBuilding(base({ footprint: { outer: U }, roof: { shape: 'dome' }, debug: true }));
    checkMesh(mesh);
    expect(mesh.debug?.spec.notes.join(' ')).toContain('using hipped');
  });
});
