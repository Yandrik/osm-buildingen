/**
 * Non-residential polish: tower composition, canopies, stations, sawtooth roofs,
 * trim. See plan/styles/non-residential.md.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES,
  type BuildingDebug,
  type BuildingInput,
  type BuildingMesh,
  type BuildingType,
  type RoofFace,
  type Vec2,
  type Vec3In,
  generateBuilding,
  resolveBuilding,
} from '../src';
import { shade } from '../src/colour';
import { pointInRing, polygonArea } from '../src/geom/polygon';
import { buildRoof } from '../src/pipeline/roofs';
import { applyRoofToWalls, buildWalls } from '../src/pipeline/walls';
import { Rng } from '../src/rng';
import { rect, rotate } from './shapes';

function checkMesh(mesh: BuildingMesh): void {
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.colors.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.indices.length).toBeGreaterThan(0);
  const vertices = mesh.positions.length / 3;
  for (const v of mesh.positions) if (!Number.isFinite(v)) throw new Error('non-finite position');
  for (const i of mesh.indices) if (i >= vertices) throw new Error('index out of range');
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    if (Math.abs(l - 1) > 1e-3) throw new Error('normal not unit length');
  }
}

const base = (over: Partial<BuildingInput> = {}): BuildingInput => ({
  footprint: { outer: rect(10, 8) },
  style: { region: 'de', modernity: 0.5 },
  seed: 'types',
  debug: true,
  ...over,
});

const partsOf = (mesh: BuildingMesh): BuildingDebug[] =>
  mesh.debug?.parts ?? (mesh.debug ? [mesh.debug] : []);
const topOf = (d: BuildingDebug): number => d.spec.base + d.spec.wallHeight + d.spec.roof.height;
const same = (a: BuildingMesh, b: BuildingMesh): void => {
  expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
  expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
};

describe('towers: podium, shaft and crown', () => {
  const tower = (over: Partial<BuildingInput> = {}): BuildingMesh =>
    generateBuilding(base({ type: 'skyscraper', footprint: { outer: rect(30, 30) }, ...over }));

  it('splits a large tower into a podium, a narrower shaft and a crown', () => {
    for (const modernity of [0, 0.5, 1]) {
      const mesh = tower({ levels: 30, style: { region: 'de', modernity }, seed: `comp-${modernity}` });
      checkMesh(mesh);
      const parts = partsOf(mesh);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      const [podium, shaft] = parts as [BuildingDebug, BuildingDebug];
      expect(podium.spec.base).toBe(0);
      expect(podium.spec.metrics.area).toBeCloseTo(900, 3);
      expect(shaft.spec.metrics.area).toBeLessThan(podium.spec.metrics.area - 50);
      expect(shaft.spec.base).toBeCloseTo(podium.spec.wallHeight, 3);
      // One entrance, on the podium.
      const doors = parts.flatMap((p) => p.facade?.cells.filter((c) => c.role === 'door') ?? []);
      expect(doors.length).toBe(1);
      expect(podium.facade?.cells.some((c) => c.role === 'door')).toBe(true);
    }
  });

  it('ends exactly at the tagged height, with level lines that match between tiers', () => {
    for (let s = 0; s < 40; s++) {
      const input = base({
        type: 'skyscraper',
        footprint: { outer: rect(30, 30) },
        ...(s % 2 === 0 ? { height: 96 + s } : { levels: 22 + s }),
        style: { region: 'de', modernity: (s % 5) / 4 },
        seed: `h${s}`,
      });
      const parts = partsOf(generateBuilding(input));
      expect(parts.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
      // What the building would be as a plain prism (same group key as its parts).
      const whole = resolveBuilding({ ...input, groupKey: `self:${input.seed}` });
      if (input.height !== undefined) expect(whole.wallHeight).toBeCloseTo(input.height, 3);
      else expect(whole.levelHeights.length).toBe(input.levels);
      expect(Math.max(...parts.map(topOf)), `seed ${s}`).toBeCloseTo(whole.wallHeight, 2);
      const grid: number[] = [];
      let y = 0;
      for (const h of whole.levelHeights) grid.push((y += h));
      for (const p of parts) {
        if (p.spec.roof.shape === 'cone') continue; // the spire's short wall is not a storey
        let line = p.spec.base;
        for (const h of p.spec.levelHeights) {
          line += h;
          const off = Math.min(...grid.map((g) => Math.abs(g - line)));
          // Levels are rounded to the millimetre, so lines drift by at most that per storey.
          expect(off, `seed ${s}, level line ${line}`).toBeLessThan(0.02);
        }
      }
    }
  });

  it('keeps the plain prism on tiny and awkward footprints', () => {
    const small = tower({ footprint: { outer: rect(12, 12) }, levels: 25 });
    expect(small.debug?.parts).toBeUndefined();
    const L: Vec2[] = [
      [0, 0],
      [40, 0],
      [40, 8],
      [8, 8],
      [8, 40],
      [0, 40],
    ];
    expect(tower({ footprint: { outer: L }, levels: 25 }).debug?.parts).toBeUndefined();
    expect(tower({ levels: 6 }).debug?.parts).toBeUndefined();
    // Mapped parts win over the synthetic ones.
    const mapped = tower({ levels: 30, parts: [{ footprint: { outer: rect(30, 30) }, levels: 30 }] });
    expect(mapped.debug?.parts?.length).toBe(1);
  });

  it('works on rotated footprints and through the office-to-skyscraper rule', () => {
    const rotated = tower({ footprint: { outer: rotate(rect(36, 24), 30) }, levels: 25 });
    checkMesh(rotated);
    expect(partsOf(rotated).length).toBeGreaterThanOrEqual(2);
    const office = generateBuilding(base({ type: 'office', footprint: { outer: rect(30, 30) }, height: 90 }));
    expect(partsOf(office)[0]?.spec.type).toBe('skyscraper');
    expect(partsOf(office).length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic', () => {
    same(tower({ seed: 'det', levels: 28 }), tower({ seed: 'det', levels: 28 }));
  });

  it('podium wider than shaft for every seed, valid and without facade fallback', () => {
    for (let s = 0; s < 200; s++) {
      const w = 18 + (s % 7) * 4;
      const mesh = tower({
        footprint: { outer: rotate(rect(w + (s % 3) * 6, w), s * 7) },
        style: { region: s % 2 ? 'us' : 'de', modernity: (s % 11) / 10 },
        seed: s,
      });
      checkMesh(mesh);
      const parts = partsOf(mesh);
      for (const p of parts) expect(p.facade?.fallback, `seed ${s}`).toBe(false);
      if (parts.length > 1)
        expect(polygonArea(parts[1]?.spec.footprint ?? { outer: [] })).toBeLessThan(
          polygonArea(parts[0]?.spec.footprint ?? { outer: [] }),
        );
    }
  });
});

/**
 * Vertical faces that stand on the ground: their widest horizontal extent (walls are
 * wide, posts are not) and one point of each.
 */
function groundFaces(mesh: BuildingMesh): { widest: number; feet: Vec2[] } {
  const P = mesh.positions;
  const N = mesh.normals;
  const I = mesh.indices;
  let widest = 0;
  const feet: Vec2[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const vs = [0, 1, 2].map((k) => (I[t + k] as number) * 3);
    const a = vs[0] as number;
    if (Math.abs(N[a + 1] as number) > 0.1) continue;
    if (Math.min(...vs.map((v) => P[v + 1] as number)) > 0.01) continue;
    for (const v of vs)
      for (const w of vs)
        widest = Math.max(
          widest,
          Math.hypot((P[v] as number) - (P[w] as number), (P[v + 2] as number) - (P[w + 2] as number)),
        );
    feet.push([P[a] as number, -(P[a + 2] as number)]);
  }
  return { widest, feet };
}

describe('canopies: roofs on posts', () => {
  const canopy = (over: Partial<BuildingInput> = {}): BuildingMesh =>
    generateBuilding(base({ type: 'canopy', footprint: { outer: rect(20, 10) }, ...over }));

  it('has posts and no walls, for every roof shape and both detail levels', () => {
    for (const shape of ['flat', 'gabled', 'hipped', 'skillion', 'round', 'pyramidal'] as const) {
      for (const detail of ['full', 'massing'] as const) {
        const mesh = canopy({ roof: { shape }, detail, seed: shape });
        checkMesh(mesh);
        const spec = mesh.debug?.spec;
        expect(spec?.type).toBe('canopy');
        expect(mesh.debug?.facade?.cells ?? []).toEqual([]);
        // Nothing wider than a post stands on the ground.
        const { widest, feet } = groundFaces(mesh);
        expect(widest, shape).toBeLessThan(0.5);
        expect(feet.length, shape).toBeGreaterThanOrEqual(4 * 4 * 2);
      }
    }
  });

  it('defaults to a few metres, scaled from carport to fuel station, and respects tags', () => {
    const carport = canopy({ footprint: { outer: rect(6, 3) } });
    const fuel = canopy();
    expect(carport.debug?.spec.wallHeight).toBeGreaterThanOrEqual(2.5);
    expect(fuel.debug?.spec.wallHeight).toBeGreaterThan(carport.debug?.spec.wallHeight ?? 0);
    expect(fuel.debug?.spec.wallHeight).toBeLessThanOrEqual(4.6);
    const tagged = canopy({ height: 5.5, minHeight: 4.6, roof: { shape: 'flat' } });
    expect(tagged.bounds.max[1]).toBeCloseTo(5.5, 3);
    expect(tagged.bounds.min[1]).toBeCloseTo(0, 3); // posts stand on the ground
    expect(canopy({ levels: 2 }).debug?.spec.levelHeights.length).toBe(2);
  });

  it('is fixed to a neighbouring wall without posts along it', () => {
    const house = rect(10, 8);
    for (let s = 0; s < 10; s++) {
      const mesh = canopy({
        footprint: { outer: rect(3.2, 6, 10, 1) },
        neighbours: [{ footprint: { outer: house } }],
        seed: s,
      });
      checkMesh(mesh);
      const { feet } = groundFaces(mesh);
      expect(feet.length).toBeGreaterThan(0);
      for (const p of feet) expect(p[0], `seed ${s}`).toBeGreaterThan(11);
    }
  });

  it('is deterministic and never falls back', () => {
    same(canopy({ seed: 'd' }), canopy({ seed: 'd' }));
    for (let s = 0; s < 200; s++) {
      const mesh = canopy({
        footprint: { outer: rotate(rect(3 + (s % 9) * 3, 3 + (s % 4) * 2), s * 11) },
        style: { region: s % 2 ? 'us' : 'de', modernity: (s % 11) / 10 },
        seed: s,
      });
      checkMesh(mesh);
      expect(mesh.debug?.facade?.fallback).toBe(false);
    }
  });
});

describe('stations: platform roofs, entrance and old facades', () => {
  const street = (y: number) => ({
    line: [
      [-80, y],
      [120, y],
    ] as Vec2[],
  });
  const track = (y: number) => ({
    line: [
      [-80, y],
      [120, y],
    ] as Vec2[],
    kind: 'rail' as const,
  });
  const station = (over: Partial<BuildingInput> = {}): BuildingMesh =>
    generateBuilding(base({ type: 'station', footprint: { outer: rect(40, 12) }, ...over }));
  /** Anything standing on the ground outside the 40 x 12 m footprint (posts). */
  const outside = (mesh: BuildingMesh): Vec2[] =>
    groundFaces(mesh).feet.filter((p) => p[1] > 12.3 || p[1] < -0.3 || p[0] < -0.3 || p[0] > 40.3);
  const doorWall = (mesh: BuildingMesh): number | undefined =>
    mesh.debug?.facade?.cells.find((c) => c.role === 'door')?.wall;

  it('puts a platform roof on the rail side and the entrance on the street side', () => {
    for (let s = 0; s < 30; s++) {
      const modernity = (s % 6) / 5;
      const north = station({ roads: [street(-8), track(21)], style: { region: 'de', modernity }, seed: s });
      checkMesh(north);
      const feet = groundFaces(north).feet;
      expect(
        feet.some((p) => p[1] > 13),
        `seed ${s}`,
      ).toBe(true);
      expect(
        feet.every((p) => p[1] > -0.5),
        `seed ${s}`,
      ).toBe(true);
      expect(doorWall(north), `seed ${s}`).toBe(0); // south wall
      // Mirrored: tracks south, street north. The rail is closer than the street, the door still goes north.
      const south = station({ roads: [street(30), track(-9)], style: { region: 'de', modernity }, seed: s });
      const feetS = groundFaces(south).feet;
      expect(
        feetS.some((p) => p[1] < -1),
        `seed ${s}`,
      ).toBe(true);
      expect(
        feetS.every((p) => p[1] < 12.5),
        `seed ${s}`,
      ).toBe(true);
      expect(doorWall(south), `seed ${s}`).toBe(2); // north wall
    }
  });

  it('builds no platform roof without a rail line along a wall', () => {
    for (const roads of [
      [street(-8)],
      [street(-8), track(60)],
      [
        {
          line: [
            [20, -80],
            [20, 80],
          ] as Vec2[],
          kind: 'rail' as const,
        },
      ],
    ]) {
      expect(outside(station({ roads }))).toEqual([]);
    }
    // Other types next to tracks get nothing either.
    expect(
      outside(
        generateBuilding(base({ type: 'office', footprint: { outer: rect(40, 12) }, roads: [track(21)] })),
      ),
    ).toEqual([]);
  });

  it('gives old stations arched windows and a symmetric street front; modern ones glass and an overhang', () => {
    const old = station({ roads: [street(-8)], year: 1890 });
    const tiles = new Set(old.debug?.facade?.cells.map((c) => c.tile));
    expect(tiles.has('win_tall')).toBe(true);
    expect(old.debug?.spec.symmetric).toBe(true);
    const modern = station({ roads: [street(-8)], year: 2015, roof: { shape: 'flat' } });
    expect(modern.debug?.spec.roof.overhang).toBeGreaterThan(1);
    expect(modern.debug?.facade?.cells.some((c) => c.tile === 'win_glass')).toBe(true);
  });

  it('is deterministic and never falls back', () => {
    same(station({ roads: [track(21)], seed: 'd' }), station({ roads: [track(21)], seed: 'd' }));
    for (let s = 0; s < 200; s++) {
      const mesh = station({
        footprint: { outer: rotate(rect(10 + (s % 7) * 5, 8 + (s % 3) * 3), s * 13) },
        roads: [street(-20), track(25), ...(s % 2 ? [track(-14)] : [])],
        style: { region: s % 2 ? 'us' : 'de', modernity: (s % 11) / 10 },
        seed: s,
      });
      checkMesh(mesh);
      expect(mesh.debug?.facade?.fallback, `seed ${s}`).toBe(false);
    }
  });
});

describe('industry: sawtooth roofs and roof details', () => {
  /** Resolve, walls and roof only, like roofs.test.ts. */
  const built = (outer: Vec2[], over: Partial<BuildingInput> = {}) => {
    const spec = resolveBuilding(
      base({ type: 'industrial', footprint: { outer }, roof: { shape: 'sawtooth' }, ...over }),
    );
    const walls = buildWalls(spec);
    const eave = spec.base + spec.wallHeight;
    const roof = buildRoof({ spec, walls, overhang: spec.footprint.outer.map(() => 0), eave });
    applyRoofToWalls(walls, roof);
    return { spec, walls, roof, eave };
  };
  /** Height of the face above a point: [height per face that covers it]. */
  const heightsAt = (faces: RoofFace[], p: Vec2): number[] =>
    faces.flatMap((face) => {
      const ring = face.points.map((q): Vec2 => [q[0], q[1]]);
      if (!pointInRing(p, ring)) return [];
      // Plane through the first three non-collinear points.
      const [a, b, c] = face.points as [Vec3In, Vec3In, Vec3In];
      const n = [
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      ] as [number, number, number];
      return [a[2] - (n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1])) / n[2]];
    });

  it('tiles the footprint with planar teeth whose glass faces one way, and the walls follow them', () => {
    const rng = new Rng(3);
    for (const [label, outer] of [
      ['rectangle', rect(60, 30)],
      ['rotated', rotate(rect(48, 30), 25)],
      ['rotated steep', rotate(rect(40, 22), 113)],
      ['square', rect(24, 24)],
    ] as [string, Vec2[]][]) {
      const { spec, walls, roof, eave } = built(outer);
      expect(spec.roof.shape, label).toBe('sawtooth');
      expect(spec.notes, label).toEqual([]);
      const glass = roof.faces.filter((f) => f.material === 'glass');
      expect(glass.length, label).toBeGreaterThanOrEqual(3);
      expect(roof.faces.length, label).toBe(2 * glass.length);
      const normals = glass.map((face): Vec2 => {
        const [a, b, c] = face.points as [Vec3In, Vec3In, Vec3In];
        return [
          (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
          (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
        ];
      });
      // All glazing faces the same way.
      const first = normals[0] as Vec2;
      for (const n of normals) expect(n[0] * first[0] + n[1] * first[1], label).toBeGreaterThan(0);
      for (const face of roof.faces) {
        const [a, b, c] = face.points as [Vec3In, Vec3In, Vec3In];
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        expect(nz, `${label}: counter-clockwise from above`).toBeGreaterThan(0);
        for (const p of face.points) {
          expect(p[2]).toBeGreaterThanOrEqual(eave - 1e-6);
          expect(p[2]).toBeLessThanOrEqual(eave + spec.roof.height + 1e-6);
        }
      }
      const box = spec.metrics.box;
      for (let k = 0; k < 200; k++) {
        const u = rng.range(-box.halfLength, box.halfLength);
        const v = rng.range(-box.halfWidth, box.halfWidth);
        const p: Vec2 = [
          box.center[0] + box.axis[0] * u + box.side[0] * v,
          box.center[1] + box.axis[1] * u + box.side[1] * v,
        ];
        if (!pointInRing(p, spec.footprint.outer)) continue;
        const hs = heightsAt(roof.faces, p);
        expect(hs.length, `${label}: ${p} under ${hs.length} faces`).toBe(1);
        expect(hs[0] as number).toBeCloseTo(eave + roof.heightAt(p), 6);
      }
      // Wall tops meet the roof: the long walls zigzag, the end walls stay level.
      for (const wall of walls) {
        for (let k = 1; k < 10; k++) {
          const t = k / 10;
          const q: Vec2 = [wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t];
          let top = 0;
          for (let j = 1; j < wall.top.length; j++) {
            const p0 = wall.top[j - 1] as { t: number; h: number };
            const p1 = wall.top[j] as { t: number; h: number };
            if (t >= p0.t && t <= p1.t) top = p0.h + ((p1.h - p0.h) * (t - p0.t)) / (p1.t - p0.t);
          }
          expect(top, label).toBeCloseTo(roof.heightAt(q), 6);
        }
      }
    }
  });

  it('is rolled for old halls on near-rectangles only and honoured when tagged', () => {
    let rolled = 0;
    for (let s = 0; s < 60; s++) {
      const spec = resolveBuilding(
        base({ type: 'industrial', footprint: { outer: rect(60, 30) }, year: 1910, seed: s }),
      );
      if (spec.roof.shape === 'sawtooth') rolled++;
      const L = resolveBuilding(
        base({
          type: 'industrial',
          footprint: {
            outer: [
              [0, 0],
              [60, 0],
              [60, 10],
              [10, 10],
              [10, 40],
              [0, 40],
            ],
          },
          year: 1910,
          seed: s,
        }),
      );
      expect(L.roof.shape).not.toBe('sawtooth');
      const modern = resolveBuilding(
        base({ type: 'industrial', footprint: { outer: rect(60, 30) }, year: 2015, seed: s }),
      );
      expect(modern.roof.shape).not.toBe('sawtooth');
    }
    expect(rolled).toBeGreaterThan(5);
    // Tagged on an L-shaped hall: still built, still valid.
    const mesh = generateBuilding(
      base({
        type: 'industrial',
        footprint: {
          outer: [
            [0, 0],
            [60, 0],
            [60, 10],
            [10, 10],
            [10, 40],
            [0, 40],
          ],
        },
        roof: { shape: 'sawtooth' },
      }),
    );
    checkMesh(mesh);
    expect(mesh.debug?.spec.roof.shape).toBe('sawtooth');
  });

  it('adds skylights, vents and stacks only as decoration: valid, deterministic, no fallback', () => {
    const hall = (over: Partial<BuildingInput>) =>
      generateBuilding(base({ type: 'industrial', footprint: { outer: rect(80, 40) }, ...over }));
    same(hall({ seed: 'd', year: 1905 }), hall({ seed: 'd', year: 1905 }));
    let stacks = 0;
    for (let s = 0; s < 200; s++) {
      const mesh = hall({
        footprint: { outer: rotate(rect(20 + (s % 6) * 12, 12 + (s % 4) * 8), s * 17) },
        style: { region: s % 2 ? 'us' : 'de', modernity: (s % 11) / 10 },
        seed: s,
      });
      checkMesh(mesh);
      expect(mesh.debug?.facade?.fallback, `seed ${s}`).toBe(false);
      const spec = mesh.debug?.spec;
      // A chimney stack stands well above the hall.
      if (spec && mesh.bounds.max[1] > spec.wallHeight + spec.roof.height + 8) stacks++;
    }
    expect(stacks).toBeGreaterThan(3);
  });
});

describe('trim on older buildings', () => {
  /** Up-facing faces in the trim colour at the top of a level band (0.1 m above a level line). */
  const bandTops = (mesh: BuildingMesh): number[][] => {
    const spec = mesh.debug?.spec;
    if (!spec) return [];
    const lines: number[] = [];
    let y = 0;
    for (const h of spec.levelHeights.slice(0, -1)) lines.push((y += h) + 0.1);
    // Box tops are drawn in the side shade of the trim colour.
    const c = shade(spec.palette.trim, 0.84);
    const out: number[][] = [];
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      if (Math.abs((mesh.normals[v * 3 + 1] as number) - 1) > 1e-4) continue;
      if (mesh.colors[v * 3] !== ((c >> 16) & 255) || mesh.colors[v * 3 + 1] !== ((c >> 8) & 255)) continue;
      const py = mesh.positions[v * 3 + 1] as number;
      if (lines.some((l) => Math.abs(l - py) < 1e-3))
        out.push([mesh.positions[v * 3] as number, py, -(mesh.positions[v * 3 + 2] as number)]);
    }
    return out;
  };

  it('puts bands on old buildings of the listed types only', () => {
    for (const type of ['house', 'townhouse', 'apartments', 'office', 'station'] as BuildingType[]) {
      let old = 0;
      // Enough seeds for a stable share: about half of the old houses (fewer for timber-heavy types) get bands.
      const seeds = 60;
      for (let s = 0; s < seeds; s++) {
        const levels = 3;
        const input = {
          type,
          footprint: { outer: rect(14, 10) },
          levels,
          roads: [
            {
              line: [
                [-40, -8],
                [60, -8],
              ] as Vec2[],
            },
          ],
          seed: s,
        };
        if (bandTops(generateBuilding(base({ ...input, year: 1905 }))).length > 0) old++;
        expect(bandTops(generateBuilding(base({ ...input, year: 1985 }))), `${type} ${s}`).toEqual([]);
      }
      // Timber-framed houses go without, so not every old one has bands.
      expect(old, type).toBeGreaterThan(seeds / 4);
    }
    for (const type of ['industrial', 'store', 'skyscraper', 'garage'] as BuildingType[]) {
      for (let s = 0; s < 10; s++)
        expect(
          bandTops(
            generateBuilding(
              base({ type, footprint: { outer: rect(14, 10) }, levels: 2, year: 1905, seed: s }),
            ),
          ),
        ).toEqual([]);
    }
  });

  it('leaves party walls bare', () => {
    const neighbour = { footprint: { outer: rect(8, 12, -8, 0) } };
    for (let s = 0; s < 20; s++) {
      const mesh = generateBuilding(
        base({
          type: 'townhouse',
          footprint: { outer: rect(8, 12) },
          neighbours: [neighbour],
          levels: 4,
          year: 1900,
          seed: s,
        }),
      );
      checkMesh(mesh);
      for (const p of bandTops(mesh)) expect(p[0], `seed ${s}`).toBeGreaterThan(-1e-3);
    }
  });

  it('keeps the triangle count modest', () => {
    const input = base({
      type: 'apartments',
      footprint: { outer: rect(22, 12) },
      levels: 5,
      roof: { shape: 'flat' },
    });
    const old = generateBuilding({ ...input, year: 1900, colours: { wall: '#e0d0b0' } });
    const lines = (old.debug?.spec.levelHeights.length ?? 1) - 1 + 1;
    // Two boxes (cornice) or one (band) per wall and line, 10 triangles each, plus corner bits.
    expect(bandTops(old).length).toBeLessThanOrEqual(4 * lines * 6 * 2);
  });
});

describe('every type over many seeds', () => {
  it('never throws and never falls back', () => {
    const streets = [
      {
        line: [
          [-60, -10],
          [80, -10],
        ] as Vec2[],
      },
      {
        line: [
          [-60, 30],
          [80, 30],
        ] as Vec2[],
        kind: 'rail' as const,
      },
    ];
    for (const type of BUILDING_TYPES) {
      const runs = type === 'skyscraper' ? 60 : 200;
      for (let s = 0; s < runs; s++) {
        const w = 4 + (s % 9) * 4;
        const outer = rotate(rect(w + (s % 4) * 3, 3 + (s % 5) * 3), s * 29);
        const mesh = generateBuilding(
          base({
            type,
            footprint: { outer },
            roads: streets,
            style: { region: s % 2 ? 'us' : 'de', modernity: (s % 13) / 12 },
            seed: `${type}-${s}`,
            detail: s % 10 === 0 ? 'massing' : 'full',
          }),
        );
        checkMesh(mesh);
        for (const p of partsOf(mesh)) if (p.facade) expect(p.facade.fallback, `${type} ${s}`).toBe(false);
      }
    }
  });
});

describe('stores', () => {
  it('get a raised front, a roller door on another wall, and stay valid', () => {
    let raised = 0;
    for (let s = 0; s < 40; s++) {
      const mesh = generateBuilding(
        base({
          type: 'store',
          footprint: { outer: rect(20, 14) },
          roof: { shape: 'flat' },
          roads: [
            {
              line: [
                [-40, -8],
                [60, -8],
              ] as Vec2[],
            },
          ],
          style: { region: 'de', modernity: (s % 5) / 4 },
          seed: s,
        }),
      );
      checkMesh(mesh);
      const spec = mesh.debug?.spec;
      const facade = mesh.debug?.facade;
      expect(facade?.streetWall).toBe(0);
      const rollers = facade?.cells.filter((c) => c.role === 'garage') ?? [];
      expect(rollers.length, `seed ${s}`).toBe(1);
      expect(rollers[0]?.wall).not.toBe(0);
      if (spec && mesh.bounds.max[1] > spec.wallHeight + spec.roof.parapet + 0.5) raised++;
    }
    expect(raised).toBeGreaterThan(15);
  });
});
