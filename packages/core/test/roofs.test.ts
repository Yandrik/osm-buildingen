import { describe, expect, it } from 'vitest';
import {
  type BuildingMesh,
  type ResolvedSpec,
  type RoofFace,
  type RoofGeometry,
  type RoofInput,
  type RoofShape,
  type Vec2,
  type WallSegment,
  generateBuilding,
  resolveBuilding,
} from '../src';
import { pointInRing } from '../src/geom/polygon';
import { buildRoof } from '../src/pipeline/roofs';
import { applyRoofToWalls, buildWalls } from '../src/pipeline/walls';
import { Rng } from '../src/rng';
import { COURTYARD, FAMILIES, FIXED_SHAPES, randomFootprint, rect } from './shapes';

interface Built {
  spec: ResolvedSpec;
  walls: WallSegment[];
  roof: RoofGeometry;
  eave: number;
  overhang: number[];
}

/** Runs resolve, walls and the roof stage, with the overhang chosen per wall. */
function build(
  footprint: { outer: Vec2[]; holes?: Vec2[][] },
  roof: RoofInput,
  overhangOf: (edge: number) => number = () => 0.4,
): Built {
  const spec = resolveBuilding({
    footprint,
    roof,
    type: 'house',
    style: { region: 'de', modernity: 0.4 },
    seed: 7,
  });
  const walls = buildWalls(spec);
  const overhang = spec.footprint.outer.map((_, i) => overhangOf(i));
  const eave = spec.base + spec.wallHeight;
  const result = buildRoof({ spec, walls, overhang, eave });
  applyRoofToWalls(walls, result);
  return { spec, walls, roof: result, eave, overhang };
}

interface Plane {
  nx: number;
  ny: number;
  nz: number;
  cx: number;
  cy: number;
  cz: number;
}

function planeOf(face: RoofFace): Plane | null {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = face.points.length;
  for (let i = 0; i < n; i++) {
    const p = face.points[i] as readonly [number, number, number];
    const q = face.points[(i + 1) % n] as readonly [number, number, number];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const l = Math.hypot(nx, ny, nz);
  if (!(l > 1e-9)) return null;
  return { nx: nx / l, ny: ny / l, nz: nz / l, cx: cx / n, cy: cy / n, cz: cz / n };
}

const flat = (face: RoofFace): Vec2[] => face.points.map((p): Vec2 => [p[0], p[1]]);

/**
 * What is wrong with a pitched roof, or null:
 *  - every face planar within 1 mm and counter-clockwise seen from above,
 *  - heights between the eave minus the overhang drop and the eave plus the roof height,
 *  - every point of the footprint under exactly one face,
 *  - wall tops (gable ends) on the roof surface, level tops where there is no gable.
 */
function roofProblem(b: Built, rng: Rng): string | null {
  const { spec, roof, eave, walls } = b;
  const planes: Plane[] = [];
  let steepest = 0;
  for (const face of roof.faces) {
    const plane = planeOf(face);
    if (!plane || face.points.length < 3) return 'degenerate face';
    if (plane.nz <= 1e-6) return 'face is not counter-clockwise from above';
    steepest = Math.max(steepest, Math.hypot(plane.nx, plane.ny) / plane.nz);
    planes.push(plane);
    for (const p of face.points) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return 'not finite';
      const off = (p[0] - plane.cx) * plane.nx + (p[1] - plane.cy) * plane.ny + (p[2] - plane.cz) * plane.nz;
      if (Math.abs(off) > 1e-3) return `face is ${off} m off its plane`;
      if (p[2] > eave + spec.roof.height + 1e-6)
        return `point ${p[2] - eave} above the eave, roof height ${spec.roof.height}`;
    }
  }
  const drop = Math.max(0, ...b.overhang) * steepest;
  for (const face of roof.faces)
    for (const p of face.points)
      if (p[2] < eave - drop - 1e-6) return `point ${eave - p[2]} below the eave, drop ${drop}`;
  for (const p of roof.outline) {
    if (p[2] < eave - drop - 1e-6 || p[2] > eave + spec.roof.height + 1e-6) return 'outline out of range';
  }

  const heightsAt = (p: Vec2): number[] => {
    const out: number[] = [];
    roof.faces.forEach((face, k) => {
      if (!pointInRing(p, flat(face))) return;
      const plane = planes[k] as Plane;
      out.push(plane.cz - ((p[0] - plane.cx) * plane.nx + (p[1] - plane.cy) * plane.ny) / plane.nz);
    });
    return out;
  };
  const { outer, holes } = spec.footprint;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let k = 0; k < 40; k++) {
    const p: Vec2 = [rng.range(minX, maxX), rng.range(minY, maxY)];
    if (!pointInRing(p, outer) || holes.some((h) => pointInRing(p, h))) continue;
    const heights = heightsAt(p);
    if (heights.length !== 1) return `footprint point ${p} is under ${heights.length} faces`;
    if ((heights[0] as number) < eave - 1e-6) return 'roof below the eave inside the footprint';
  }

  for (const wall of walls) {
    if (wall.length < 0.5) continue;
    for (const p of wall.top) if (!(p.h >= 0) || p.t < 0 || p.t > 1) return 'bad wall top';
    for (let k = 0; k < 3; k++) {
      const t = rng.range(0.05, 0.95);
      const inside: Vec2 = [
        wall.a[0] + (wall.b[0] - wall.a[0]) * t - wall.normal[0] * 1e-4,
        wall.a[1] + (wall.b[1] - wall.a[1]) * t - wall.normal[1] * 1e-4,
      ];
      const heights = heightsAt(inside);
      if (heights.length !== 1) continue;
      let top = 0;
      for (let j = 1; j < wall.top.length; j++) {
        const p = wall.top[j - 1] as { t: number; h: number };
        const q = wall.top[j] as { t: number; h: number };
        if (t >= p.t && t <= q.t) top = p.h + ((q.h - p.h) * (t - p.t)) / (q.t - p.t);
      }
      if (Math.abs(eave + top - (heights[0] as number)) > 0.01)
        return `wall ${wall.index} top is ${eave + top - (heights[0] as number)} m off the roof`;
    }
  }
  return null;
}

const failed = (spec: ResolvedSpec): boolean => spec.notes.some((n) => n.includes('using flat'));
const gableWalls = (b: Built): WallSegment[] => b.walls.filter((w) => w.top.length > 0);
const counts = (roof: RoofGeometry): number[] => roof.faces.map((f) => f.points.length).sort((a, b) => a - b);

const OVERHANGS: [string, (edge: number) => number][] = [
  ['no overhang', () => 0],
  ['overhang all round', () => 0.4],
  ['overhang on every other wall', (i) => (i % 2 === 0 ? 0.4 : 0)],
  ['overhang on one wall', (i) => (i === 1 ? 0.5 : 0)],
];

describe('hipped roofs', () => {
  it('rectangle: two trapezoids and two triangles', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'hipped', height: 3 });
    expect(counts(b.roof)).toEqual([3, 3, 4, 4]);
    expect(roofProblem(b, new Rng(1))).toBeNull();
    const heights = b.roof.faces.flatMap((f) => f.points.map((p) => p[2] - b.eave));
    expect(Math.max(...heights)).toBeCloseTo(3, 9);
    // Overhang 0.4 at a slope of 3 / 4.
    expect(Math.min(...heights)).toBeCloseTo(-0.3, 9);
    expect(b.roof.outline.length).toBe(4);
    for (const p of b.roof.outline) expect(p[2] - b.eave).toBeCloseTo(-0.3, 9);
    const xs = b.roof.outline.map((p) => p[0]).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(-0.4, 9);
    expect(xs[3]).toBeCloseTo(10.4, 9);
  });

  it('rectangle without overhang sits on the walls', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'hipped', height: 3 }, () => 0);
    expect(counts(b.roof)).toEqual([3, 3, 4, 4]);
    expect(b.roof.outline).toEqual([]);
    expect(Math.min(...b.roof.faces.flatMap((f) => f.points.map((p) => p[2])))).toBeCloseTo(b.eave, 9);
  });

  for (const [name, outer] of Object.entries(FIXED_SHAPES)) {
    it(`${name}: valid for every overhang pattern`, () => {
      for (const [label, overhangOf] of OVERHANGS) {
        const b = build({ outer }, { shape: 'hipped' }, overhangOf);
        expect(b.spec.roof.shape, label).toBe('hipped');
        expect(
          b.spec.notes.filter((n) => n.includes('roof')),
          label,
        ).toEqual([]);
        expect(roofProblem(b, new Rng(2)), label).toBeNull();
        // One face per wall, no gable walls.
        expect(b.roof.faces.length, label).toBe(b.spec.footprint.outer.length);
        expect(gableWalls(b), label).toEqual([]);
        for (const wall of b.walls) {
          expect(b.roof.breaks(wall)).toEqual([]);
          expect(b.roof.heightAt(wall.a)).toBe(0);
          expect(b.roof.heightAt([(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2])).toBe(0);
        }
      }
    });
  }

  it('the ridge of an L is at half the wing width', () => {
    const b = build({ outer: FIXED_SHAPES.L as Vec2[] }, { shape: 'hipped', height: 3 }, () => 0);
    const top = b.roof.faces.flatMap((f) => f.points).filter((p) => p[2] > b.eave + 3 - 1e-9);
    // Wings are 6 m wide: the ridge points are 3 m from the walls.
    expect(top.length).toBeGreaterThan(0);
    for (const p of top) expect(Math.min(p[0], p[1])).toBeCloseTo(3, 6);
  });

  it('courtyard: a ring of roof, no overhang into the yard', () => {
    const b = build(COURTYARD, { shape: 'hipped' });
    expect(b.spec.roof.shape).toBe('hipped');
    expect(failed(b.spec)).toBe(false);
    expect(b.roof.faces.length).toBe(8);
    expect(roofProblem(b, new Rng(3))).toBeNull();
    // Nothing covers the yard.
    for (const face of b.roof.faces) expect(pointInRing([10, 9], flat(face))).toBe(false);
    // A pitched shape that cannot go around a courtyard becomes hipped.
    expect(build(COURTYARD, { shape: 'gabled' }).spec.roof.shape).toBe('hipped');
    expect(build(COURTYARD, { shape: 'flat' }).spec.roof.shape).toBe('flat');
  });
});

describe('roof height from the pitch', () => {
  const heightOf = (footprint: { outer: Vec2[]; holes?: Vec2[][] }, shape: RoofShape): number =>
    resolveBuilding({
      footprint,
      roof: { shape },
      type: 'house',
      style: { region: 'de', modernity: 0.4 },
      seed: 7,
    }).roof.height;

  it('follows the wing width, not the bounding box', () => {
    // Same pitch: a 12 x 11 rectangle spans 5.5 m to the ridge, the L with 6 m wings 3 m.
    const box = heightOf({ outer: rect(12, 11) }, 'hipped');
    const wings = heightOf({ outer: FIXED_SHAPES.L as Vec2[] }, 'hipped');
    expect(wings / box).toBeCloseTo(3 / 5.5, 2);
    expect(heightOf({ outer: FIXED_SHAPES.L as Vec2[] }, 'gabled')).toBe(wings);
    // A courtyard block is as high as a house of the same depth (5 m), not of the same width.
    expect(heightOf(COURTYARD, 'hipped')).toBe(heightOf({ outer: rect(30, 5) }, 'hipped'));
  });
});

describe('gabled roofs', () => {
  it('rectangle: the exact single ridge, also across', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'gabled', height: 3 });
    expect(b.roof.faces.length).toBe(2);
    expect(gableWalls(b).map((w) => w.index)).toEqual([1, 3]);
    const across = build({ outer: rect(10, 8) }, { shape: 'gabled', height: 3, ridge: 'across' });
    expect(gableWalls(across).map((w) => w.index)).toEqual([0, 2]);
  });

  const wings: [string, number[]][] = [
    ['L', [1, 4]],
    ['T', [2, 5, 7]],
    ['U', [0, 4]],
    ['plus', [0, 3, 6, 9]],
    ['H', [0, 4, 6, 10]],
    ['rotatedL', [1, 4]],
    ['staircase', [1, 6]],
  ];
  for (const [name, ends] of wings) {
    it(`${name}: a gable wall at the end of every wing`, () => {
      for (const [label, overhangOf] of OVERHANGS) {
        const b = build({ outer: FIXED_SHAPES[name] as Vec2[] }, { shape: 'gabled' }, overhangOf);
        expect(
          b.spec.notes.filter((n) => n.includes('roof')),
          label,
        ).toEqual([]);
        expect(roofProblem(b, new Rng(4)), label).toBeNull();
        expect(
          gableWalls(b).map((w) => w.index),
          label,
        ).toEqual(ends);
        // One face per wall that is not a gable end.
        expect(b.roof.faces.length, label).toBe(b.spec.footprint.outer.length - ends.length);
        for (const wall of gableWalls(b)) {
          expect(b.roof.breaks(wall)[0]).toBeCloseTo(0.5, 9);
          expect(wall.top.length).toBe(3);
          expect(wall.top[1]?.t).toBeCloseTo(0.5, 9);
          expect(wall.top[0]?.h).toBe(0);
          expect(wall.top[1]?.h).toBeGreaterThan(0.5);
          expect(wall.top[2]?.h).toBe(0);
        }
      }
    });
  }

  it('L: the gable peaks are as high as the ridge they close', () => {
    const b = build({ outer: FIXED_SHAPES.L as Vec2[] }, { shape: 'gabled', height: 3 }, () => 0);
    // Wing ends are 6 m and 5 m wide... the 6 m one reaches the full roof height.
    const peaks = gableWalls(b).map((w) => w.top[1]?.h ?? 0);
    expect(peaks[0]).toBeCloseTo(3, 9);
    expect(peaks[1]).toBeCloseTo(3, 9);
    // The roof has a vertex on top of each gable wall.
    for (const wall of gableWalls(b)) {
      const mid: Vec2 = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
      const hit = b.roof.faces
        .flatMap((f) => f.points)
        .some((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1]) < 1e-9 && Math.abs(p[2] - b.eave - 3) < 1e-9);
      expect(hit).toBe(true);
    }
  });

  it('without wing ends the ridge goes on the box axis, and says so', () => {
    const b = build({ outer: FIXED_SHAPES.triangle as Vec2[] }, { shape: 'gabled' });
    expect(b.spec.roof.shape).toBe('gabled');
    expect(b.roof.faces.length).toBe(2);
    expect(b.spec.notes.some((n) => n.includes('single ridge on the box axis'))).toBe(true);
  });
});

describe('half-hipped, gambrel and mansard roofs', () => {
  for (const name of ['rectangle', 'L', 'T', 'plus', 'quad']) {
    it(`${name}: valid for every overhang pattern`, () => {
      for (const shape of ['half-hipped', 'gambrel', 'mansard'] as RoofShape[]) {
        for (const [label, overhangOf] of OVERHANGS) {
          const b = build({ outer: FIXED_SHAPES[name] as Vec2[] }, { shape }, overhangOf);
          expect(b.spec.roof.shape, `${shape}, ${label}`).toBe(shape);
          expect(
            b.spec.notes.filter((n) => n.includes('roof')),
            `${shape}, ${label}`,
          ).toEqual([]);
          expect(roofProblem(b, new Rng(5)), `${shape}, ${label}`).toBeNull();
        }
      }
    });
  }

  it('half-hipped rectangle: gable walls with a level top under a small hip', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'half-hipped', height: 4 }, () => 0);
    // Two main faces and two hips.
    expect(counts(b.roof)).toEqual([3, 3, 6, 6]);
    expect(gableWalls(b).map((w) => w.index)).toEqual([1, 3]);
    for (const wall of gableWalls(b)) {
      expect(wall.top.length).toBe(4);
      expect(wall.top[1]?.t).toBeCloseTo(0.3, 9);
      expect(wall.top[2]?.t).toBeCloseTo(0.7, 9);
      expect(wall.top[1]?.h).toBeCloseTo(2.4, 9);
      expect(wall.top[2]?.h).toBeCloseTo(2.4, 9);
    }
  });

  it('gambrel rectangle: the gable wall follows both pitches', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'gambrel', height: 4 }, () => 0);
    expect(b.roof.faces.length).toBe(4);
    const wall = gableWalls(b)[0] as WallSegment;
    expect(wall.top.length).toBe(5);
    expect(wall.top[2]?.h).toBeCloseTo(4, 9);
    // Steeper below the kink than above it.
    const [p0, p1, p2] = wall.top as [
      { t: number; h: number },
      { t: number; h: number },
      { t: number; h: number },
    ];
    expect((p1.h - p0.h) / (p1.t - p0.t)).toBeGreaterThan((p2.h - p1.h) / (p2.t - p1.t));
  });

  it('a third face ending in a gable peak stays flat', () => {
    // The hip from the step at (13, 3) runs straight into the peak of the west gable.
    const outer: Vec2[] = [
      [7, 3],
      [13, 3],
      [13, 4],
      [21, 4],
      [21, 11],
      [20, 11],
      [20, 16],
      [8, 16],
      [8, 15],
      [7, 15],
    ];
    for (const shape of ['gambrel', 'half-hipped'] as RoofShape[]) {
      const b = build({ outer }, { shape });
      expect(b.spec.notes.filter((n) => n.includes('roof'))).toEqual([]);
      expect(gableWalls(b).map((w) => w.index)).toEqual([3, 9]);
      expect(roofProblem(b, new Rng(6))).toBeNull();
    }
  });

  it('mansard rectangle: a steep skirt and a shallow top, no overhang', () => {
    const b = build({ outer: rect(10, 8) }, { shape: 'mansard', height: 4 });
    expect(b.roof.faces.length).toBe(8);
    expect(b.roof.outline).toEqual([]);
    expect(gableWalls(b)).toEqual([]);
    const slopes = b.roof.faces.map((f) => {
      const plane = planeOf(f) as Plane;
      return Math.hypot(plane.nx, plane.ny) / plane.nz;
    });
    expect(Math.max(...slopes)).toBeGreaterThan(1.5);
    expect(Math.min(...slopes)).toBeLessThan(0.6);
  });
});

describe('roofs on random footprints', () => {
  const COUNT = 200;
  const shapes: RoofShape[] = ['hipped', 'gabled', 'half-hipped', 'gambrel', 'mansard'];
  for (const family of FAMILIES) {
    it(`${family}: every roof that is built is valid`, () => {
      const rng = new Rng(300 + FAMILIES.indexOf(family));
      const probe = new Rng(9);
      let flatFallbacks = 0;
      for (let i = 0; i < COUNT; i++) {
        const outer = randomFootprint(family, rng);
        const pattern = rng.int(3);
        const picks = outer.map(() => rng.chance(0.5));
        for (const shape of shapes) {
          const b = build({ outer }, { shape }, (edge) =>
            pattern === 0 ? 0 : pattern === 1 || picks[edge % picks.length] ? 0.4 : 0,
          );
          if (failed(b.spec)) {
            flatFallbacks++;
            continue;
          }
          // The single ridge on the box axis is older code with looser guarantees.
          const single =
            b.roof.faces.length === 2 && b.spec.notes.some((n) => n.includes('single ridge on the box axis'));
          const nearRectangle = b.spec.metrics.rectangularity > 0.92 && b.roof.faces.length === 2;
          if (single || nearRectangle) continue;
          const wrong = roofProblem(b, probe);
          if (wrong)
            throw new Error(`${shape}: ${wrong}\n${JSON.stringify(outer)}\n${JSON.stringify(b.overhang)}`);
        }
      }
      expect(flatFallbacks / (COUNT * shapes.length)).toBeLessThanOrEqual(0.01);
    });
  }
});

function meshProblem(mesh: BuildingMesh): string | null {
  const vertices = mesh.positions.length / 3;
  if (mesh.positions.length % 3 !== 0 || mesh.indices.length % 3 !== 0) return 'buffer lengths';
  if (mesh.normals.length !== mesh.positions.length || mesh.colors.length !== mesh.positions.length)
    return 'attribute lengths differ';
  if (mesh.indices.length === 0) return 'empty mesh';
  for (const v of mesh.positions) if (!Number.isFinite(v)) return 'position not finite';
  for (const i of mesh.indices) if (i >= vertices) return 'index out of range';
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    if (Math.abs(l - 1) > 1e-3) return 'normal not unit length';
  }
  return null;
}

describe('generateBuilding with skeleton roofs', () => {
  it('fixed footprints, full detail', () => {
    const footprints: { outer: Vec2[]; holes?: Vec2[][] }[] = [
      ...Object.values(FIXED_SHAPES).map((outer) => ({ outer })),
      COURTYARD,
    ];
    for (const footprint of footprints) {
      for (const shape of ['hipped', 'gabled'] as RoofShape[]) {
        const mesh = generateBuilding({
          footprint,
          roof: { shape, height: 3.5 },
          type: 'house',
          levels: 2,
          style: { region: 'de', modernity: 0.4 },
          seed: 3,
          debug: true,
        });
        expect(meshProblem(mesh)).toBeNull();
        const spec = mesh.debug?.spec as ResolvedSpec;
        expect(failed(spec)).toBe(false);
        // The ridge is exactly where the spec says.
        expect(mesh.bounds.max[1]).toBeCloseTo(spec.base + spec.wallHeight + 3.5, 3);
      }
    }
  });

  it('random footprints, massing only', () => {
    const COUNT = 150;
    let total = 0;
    let fallbacks = 0;
    for (const family of FAMILIES) {
      const rng = new Rng(500 + FAMILIES.indexOf(family));
      for (let i = 0; i < COUNT; i++) {
        const outer = randomFootprint(family, rng);
        for (const shape of ['hipped', 'gabled'] as RoofShape[]) {
          const mesh = generateBuilding({
            footprint: { outer },
            roof: { shape },
            type: 'house',
            style: { region: 'de', modernity: rng.next() },
            seed: i,
            detail: 'massing',
            debug: true,
          });
          const wrong = meshProblem(mesh);
          if (wrong) throw new Error(`${shape}: ${wrong}\n${JSON.stringify(outer)}`);
          const spec = mesh.debug?.spec as ResolvedSpec;
          expect(spec.roof.shape).toBe(shape);
          total++;
          if (failed(spec) || spec.notes.some((n) => n.includes('skeleton failed'))) fallbacks++;
        }
      }
    }
    expect(fallbacks / total).toBeLessThanOrEqual(0.01);
  });

  it('is deterministic', () => {
    const input = {
      footprint: { outer: FIXED_SHAPES.T as Vec2[] },
      roof: { shape: 'gabled' as RoofShape },
      style: { region: 'de' as const, modernity: 0.5 },
      seed: 11,
    };
    expect(Array.from(generateBuilding(input).positions)).toEqual(
      Array.from(generateBuilding(input).positions),
    );
  });
});
