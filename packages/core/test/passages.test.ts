import { describe, expect, it } from 'vitest';
import {
  type BuildingDebug,
  type BuildingInput,
  type BuildingMesh,
  type Passage,
  type Vec2,
  type Vec3,
  generateBuilding,
} from '../src';
import { pointInPolygon } from '../src/geom/polygon';
import { PASSAGE_SCENES, type PassageScene } from './passageScenes';
import { rect } from './shapes';

function checkMesh(mesh: BuildingMesh): void {
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.colors.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.indices.length).toBeGreaterThan(0);
  const vertices = mesh.positions.length / 3;
  let finite = true;
  for (const v of mesh.positions) finite &&= Number.isFinite(v);
  expect(finite).toBe(true);
  let inRange = true;
  for (const i of mesh.indices) inRange &&= i < vertices;
  expect(inRange).toBe(true);
  let unit = true;
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    unit &&= Math.abs(l - 1) < 1e-3;
  }
  expect(unit).toBe(true);
}

// --- A tiny ray caster over the mesh triangles -------------------------------------------

interface Hit {
  /** Distance from the ray origin, metres. */
  distance: number;
  /** The ray meets the face from its outside. A back-face hit is a hole for a renderer that culls. */
  front: boolean;
  /** The hit lies well inside the triangle, not on an edge shared with its neighbours. */
  interior: boolean;
  normal: Vec3;
  point: Vec3;
}

/** Footprint point and height -> output space. */
const world = (p: Vec2, h: number): Vec3 => [p[0], h, -p[1]];

/** All intersections of the segment from -> to with the mesh, nearest first (Möller–Trumbore). */
function cast(mesh: BuildingMesh, from: Vec3, to: Vec3): Hit[] {
  const { positions: P, normals: N, indices: I } = mesh;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const dx = (to[0] - from[0]) / len;
  const dy = (to[1] - from[1]) / len;
  const dz = (to[2] - from[2]) / len;
  const hits: Hit[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = (I[t] as number) * 3;
    const b = (I[t + 1] as number) * 3;
    const c = (I[t + 2] as number) * 3;
    const ax = P[a] as number;
    const ay = P[a + 1] as number;
    const az = P[a + 2] as number;
    const e1x = (P[b] as number) - ax;
    const e1y = (P[b + 1] as number) - ay;
    const e1z = (P[b + 2] as number) - az;
    const e2x = (P[c] as number) - ax;
    const e2y = (P[c + 1] as number) - ay;
    const e2z = (P[c + 2] as number) - az;
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const sx = from[0] - ax;
    const sy = from[1] - ay;
    const sz = from[2] - az;
    const u = (sx * px + sy * py + sz * pz) / det;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) / det;
    if (v < 0 || u + v > 1) continue;
    const distance = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (distance < 1e-6 || distance > len) continue;
    const normal: Vec3 = [N[a] as number, N[a + 1] as number, N[a + 2] as number];
    hits.push({
      distance,
      front: normal[0] * dx + normal[1] * dy + normal[2] * dz < 0,
      interior: Math.min(u, v, 1 - u - v) > 0.01,
      normal,
      point: [from[0] + dx * distance, from[1] + dy * distance, from[2] + dz * distance],
    });
  }
  return hits.sort((x, y) => x.distance - y.distance);
}

/**
 * What a back-face-culling renderer would get wrong along this ray: 'hole' when the
 * first surface met is seen from behind (a face is missing or wound the wrong way),
 * 'fight' when it consists of two faces with the same orientation in the same plane.
 * Only surfaces accepted by `where` count, so that a flaw in some window far from
 * the passage does not fail a passage test.
 */
function defect(hits: Hit[], where: (p: Vec3) => boolean): 'hole' | 'fight' | null {
  const first = hits[0];
  if (!first || !where(first.point)) return null;
  const surface = hits.filter((h) => h.distance - first.distance < 1e-4);
  // Two faces back to back (the reveals of neighbouring windows) are met at the same
  // distance; that is a closed surface as long as one of them faces the ray.
  if (first.interior && !surface.some((h) => h.front)) return 'hole';
  const facing = surface.filter((h) => h.front && h.interior);
  for (let i = 0; i < facing.length; i++) {
    for (let j = i + 1; j < facing.length; j++) {
      const a = (facing[i] as Hit).normal;
      const b = (facing[j] as Hit).normal;
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.999) return 'fight';
    }
  }
  return null;
}

/** Deterministic directions spread over the sphere. */
function directions(n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

const partsOf = (mesh: BuildingMesh): BuildingDebug[] =>
  mesh.debug?.parts ?? (mesh.debug ? [mesh.debug] : []);
const passagesOf = (mesh: BuildingMesh): Passage[] => partsOf(mesh).flatMap((p) => p.passages);

/** Points well inside a passage: on a grid, at least `margin` away from its outline. */
function pointsInside(p: Passage, margin: number): Vec2[] {
  const xs = p.polygon.map((q) => q[0]);
  const ys = p.polygon.map((q) => q[1]);
  const polygon = { outer: p.polygon, holes: p.holes };
  const out: Vec2[] = [];
  const step = 1.3;
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      const near: Vec2[] = [
        [x, y],
        [x - margin, y],
        [x + margin, y],
        [x, y - margin],
        [x, y + margin],
      ];
      if (near.every((q) => pointInPolygon(q, polygon))) out.push([x, y]);
    }
  }
  return out;
}

const scene = (name: string): PassageScene => {
  const found = PASSAGE_SCENES.find((s) => s.name === name);
  if (!found) throw new Error(`no scene ${name}`);
  return found;
};

describe('passages', () => {
  for (const s of PASSAGE_SCENES) {
    it(`${s.name}: ${s.passages} passage(s), corridor empty, walls closed`, () => {
      const mesh = generateBuilding(s.input);
      checkMesh(mesh);
      const passages = passagesOf(mesh);
      expect(passages.length).toBe(s.passages);

      // The corridor is empty from the ground up to just under the ceiling.
      const lowest = Math.min(2.5, ...passages.map((p) => p.clearHeight));
      for (const [a, b] of s.clear) {
        for (const h of [0.2, 1, lowest - 0.3]) expect(cast(mesh, world(a, h), world(b, h))).toEqual([]);
      }
      // Near its sides the arch comes down to its springing, so only up to there.
      for (const [a, b] of s.edge ?? []) {
        for (const h of [0.2, 1, 1.7]) expect(cast(mesh, world(a, h), world(b, h))).toEqual([]);
      }
      // Above the ceiling the building goes on.
      if (passages.length > 0) {
        const highest = Math.max(...passages.map((p) => p.clearHeight));
        for (const [a, b] of s.clear)
          expect(cast(mesh, world(a, highest + 0.5), world(b, highest + 0.5)).length).toBeGreaterThan(0);
      }
      // And beside the corridor there is no opening.
      for (const [a, b] of s.solid) expect(cast(mesh, world(a, 1), world(b, 1)).length).toBeGreaterThan(0);

      for (const part of partsOf(mesh)) {
        // Arch cells sit on the ground row, exactly under the spans of the context.
        const cells = part.facade?.cells ?? [];
        for (const cell of cells) {
          const spans = part.context[cell.wall]?.passages ?? [];
          const open =
            cell.row === 0 &&
            spans.some((sp) => sp.to > cell.x + 1e-3 && sp.from < cell.x + cell.width - 1e-3);
          expect(cell.role === 'arch').toBe(open);
          if (open) expect(cell.openings?.length).toBeGreaterThan(0);
        }
        // Every opening of a passage is a span on its wall, and there are no others.
        const spans = part.context.flatMap((c, wall) => c.passages.map((sp) => ({ wall, ...sp })));
        expect(spans.length).toBe(part.passages.reduce((n, p) => n + p.openings.length, 0));
        for (const p of part.passages) {
          expect(p.clearHeight).toBeGreaterThanOrEqual(2.2);
          expect(p.clearHeight).toBeLessThan(part.spec.levelHeights[0] as number);
          for (const o of p.openings) {
            expect(o.to - o.from).toBeGreaterThan(0);
            expect(spans.some((sp) => sp.wall === o.wall && sp.from === o.from && sp.to === o.to)).toBe(true);
          }
        }
      }
    });
  }

  it('shows no hole and no coplanar faces, from inside the tunnel and from outside', () => {
    const dirs = directions(Number(process.env.PASSAGE_RAYS ?? 60));
    for (const s of PASSAGE_SCENES) {
      const mesh = generateBuilding(s.input);
      let rays = 0;
      for (const p of passagesOf(mesh)) {
        // The tunnel and the facade around its mouths.
        const xs = p.polygon.map((q) => q[0]);
        const ys = p.polygon.map((q) => q[1]);
        const where = (v: Vec3): boolean =>
          v[0] > Math.min(...xs) - 1 &&
          v[0] < Math.max(...xs) + 1 &&
          -v[2] > Math.min(...ys) - 1 &&
          -v[2] < Math.max(...ys) + 1 &&
          v[1] < p.clearHeight + 0.3;
        // Keep out of the wall thickness above the arches, which reaches 0.3 m into the tunnel.
        for (const q of pointsInside(p, 0.45)) {
          // Straight up there is the ceiling, at the clear height.
          const up = cast(mesh, world(q, 0.5), world(q, p.clearHeight + 0.2));
          expect(up[0]?.distance, `${s.name}: ceiling`).toBeCloseTo(p.clearHeight - 0.5, 3);
          for (const h of [0.4, p.clearHeight - 0.25]) {
            const eye = world(q, h);
            for (const d of dirs) {
              // Looking around from inside the tunnel.
              const out: Vec3 = [eye[0] + d[0] * 80, eye[1] + d[1] * 80, eye[2] + d[2] * 80];
              expect(
                defect(cast(mesh, eye, out), where),
                `${s.name}: from inside, direction ${d}`,
              ).toBeNull();
              // Looking at that point from outside, from eye level up to roof height.
              if (d[1] >= 0 && d[1] < 0.5) {
                expect(
                  defect(cast(mesh, out, eye), where),
                  `${s.name}: from outside, direction ${d}`,
                ).toBeNull();
              }
              rays++;
            }
          }
        }
      }
      if (s.passages > 0) expect(rays, s.name).toBeGreaterThan(300);
    }
  });

  it('opens the walls where the corridor meets them', () => {
    // Straight through: 5 m wide (road 4 m + 1 m), centred on the road, on both long walls.
    const straight = generateBuilding(scene('straight').input).debug as BuildingDebug;
    const p = straight.passages[0] as Passage;
    expect(p.openings.map((o) => o.wall).sort()).toEqual([0, 2]);
    for (const o of p.openings) {
      expect(o.from).toBeCloseTo(12.5, 3);
      expect(o.to).toBeCloseTo(17.5, 3);
      expect(o.openFrom).toBe(o.from);
      expect(o.capFrom || o.capTo).toBe(false);
    }
    expect(p.sides.length).toBe(2);
    expect(straight.context[1]?.passages).toEqual([]);
    expect(straight.context[3]?.passages).toEqual([]);

    // Oblique: the opening is wider than the corridor by 1 / sin of the crossing angle.
    const oblique = generateBuilding(scene('oblique').input).debug as BuildingDebug;
    const q = oblique.passages[0] as Passage;
    const width = 5 / Math.sin(Math.atan2(35, 26));
    const south = q.openings.find((o) => o.wall === 0);
    const north = q.openings.find((o) => o.wall === 2);
    expect(south && south.to - south.from).toBeCloseTo(width, 2);
    expect(north && north.to - north.from).toBeCloseTo(width, 2);
    // The road crosses y = 0 at x = 12.914 and y = 11 at x = 21.086 (wall 2 runs from x = 34 back to 0).
    expect(south && (south.from + south.to) / 2).toBeCloseTo(12.914, 2);
    expect(north && 34 - (north.from + north.to) / 2).toBeCloseTo(21.086, 2);
    // One jamb of each opening has the tunnel wall running away behind it.
    expect(south && south.capFrom !== south.capTo).toBe(true);

    // Courtyard: outer wall and courtyard wall.
    const yard = generateBuilding(scene('courtyard').input).debug as BuildingDebug;
    const walls = (yard.passages[0] as Passage).openings.map((o) => yard.walls[o.wall]?.ring);
    expect(walls.sort()).toEqual([0, 1]);

    // Crossing roads: one tunnel with four mouths; two overlapping roads: one wide mouth per side.
    const cross = generateBuilding(scene('crossing').input).debug as BuildingDebug;
    expect((cross.passages[0] as Passage).openings.length).toBe(4);
    const wide = generateBuilding(scene('overlap').input).debug as BuildingDebug;
    for (const o of (wide.passages[0] as Passage).openings) expect(o.to - o.from).toBeCloseTo(8, 3);
  });

  it('keeps doors and windows out of the opening and upper levels untouched', () => {
    for (const s of PASSAGE_SCENES) {
      for (const part of partsOf(generateBuilding(s.input))) {
        for (const cell of part.facade?.cells ?? []) {
          if (cell.role === 'arch') expect(cell.row).toBe(0);
          if (cell.row > 0) expect(cell.openings).toBeUndefined();
        }
      }
    }
    // With a road through the middle the entrance still exists, beside the passage.
    const debug = generateBuilding(scene('straight').input).debug as BuildingDebug;
    const door = debug.facade?.cells.find((c) => c.role === 'door');
    expect(door).toBeDefined();
    expect(door?.openings).toBeUndefined();
  });

  it('turns walks along a facade into arcades, but not passages along a party wall', () => {
    const kind = (name: string): (string | undefined)[] =>
      passagesOf(generateBuilding(scene(name).input)).map((p) => p.arcade);
    expect(kind('arcade')).toEqual(['arcade']);
    expect(kind('colonnade-small')).toEqual(['colonnade']);
    expect(kind('arcade-untagged')).toHaveLength(1);
    expect(kind('arcade-untagged')[0]).toBeDefined();
    expect(kind('party-wall')).toEqual([undefined]);
    expect(kind('covered-narrow')).toEqual([undefined]);

    // Arcade bays fill the ground row along the walk; the storeys above keep their windows.
    const arcade = generateBuilding(scene('arcade').input).debug as BuildingDebug;
    const south = arcade.facade?.cells.filter((c) => c.wall === 0) ?? [];
    for (const c of south) {
      if (c.row === 0) expect(c.openings?.[0]?.arcade).toBe('arcade');
      else expect(c.openings).toBeUndefined();
    }
    expect(south.some((c) => c.row > 0 && c.role === 'window')).toBe(true);
    // The walk takes the whole ground storey, minus the slab.
    const p = arcade.passages[0] as Passage;
    expect(p.clearHeight).toBeCloseTo((arcade.spec.levelHeights[0] as number) - 0.3, 6);

    // Along the party wall: a plain opening against the neighbour, and the street end does not
    // share one long arch with it around the corner.
    const party = generateBuilding(scene('party-wall').input).debug as BuildingDebug;
    const spans = party.context.flatMap((c) => c.passages);
    expect(spans.find((sp) => sp.to - sp.from > 10)?.flat).toBe(true);
    for (const sp of spans) expect(sp.openTo - sp.openFrom).toBeLessThan(13);
  });

  it('cuts through the wall between two parts and uses plain openings there', () => {
    const mesh = generateBuilding(scene('parts-across').input);
    const [tall, low] = partsOf(mesh);
    // East wall of the tall part and west wall of the low part lie on x = 18.
    const joint = (d: BuildingDebug | undefined): { flat: boolean; from: number; to: number }[] =>
      (d?.context ?? []).flatMap((c, w) => {
        const wall = d?.walls[w];
        return wall && Math.abs(wall.a[0] - 18) < 1e-6 && Math.abs(wall.b[0] - 18) < 1e-6 ? c.passages : [];
      });
    expect(joint(tall).length).toBe(1);
    expect(joint(low).length).toBe(1);
    expect(joint(tall)[0]?.flat).toBe(true);
    expect(joint(low)[0]?.flat).toBe(true);
    // The street ends are arched.
    const street = (d: BuildingDebug | undefined): boolean[] =>
      (d?.context ?? []).flatMap((c) => c.passages.map((sp) => sp.flat)).filter((flat) => !flat);
    expect(street(tall).length).toBe(1);
    expect(street(low).length).toBe(1);
  });

  it('does not cut parts that start above the ground', () => {
    const mesh = generateBuilding(scene('parts-bridge').input);
    const bridge = partsOf(mesh).find((p) => p.spec.base > 0.5);
    expect(bridge).toBeDefined();
    expect(bridge?.passages).toEqual([]);
    // The bridge is there above the gap.
    const h = (bridge?.spec.base ?? 0) + 1;
    expect(cast(mesh, world([15, -6], h), world([15, 16], h)).length).toBeGreaterThan(0);
  });

  it('skips a passage under a ground level that is too low, with a note', () => {
    const input: BuildingInput = {
      ...scene('straight').input,
      levels: 2,
      height: 4.2,
    };
    const mesh = generateBuilding(input);
    checkMesh(mesh);
    expect(mesh.debug?.passages).toEqual([]);
    expect(mesh.debug?.spec.notes.join(' ')).toContain('too low');
    expect(cast(mesh, world([15, -6], 1), world([15, 16], 1)).length).toBeGreaterThan(0);
  });

  it('gives roads the higher clearance than paths, within the ground level', () => {
    const tall = (kind: 'road' | 'path'): number => {
      const mesh = generateBuilding({
        ...scene('straight').input,
        type: 'office',
        roads: [
          {
            line: [
              [15, -30],
              [15, 40],
            ],
            width: 4,
            kind,
            passage: true,
          },
        ],
      });
      return mesh.debug?.passages[0]?.clearHeight ?? 0;
    };
    expect(tall('path')).toBeCloseTo(2.8, 6);
    expect(tall('road')).toBeGreaterThan(2.8);
    expect(tall('road')).toBeLessThanOrEqual(3.8);
  });

  it('ignores rails and roads that stay outside', () => {
    const base = scene('straight').input;
    const line: Vec2[] = [
      [15, -30],
      [15, 40],
    ];
    expect(
      generateBuilding({ ...base, roads: [{ line, kind: 'rail', passage: true }] }).debug?.passages,
    ).toEqual([]);
    // Along the south wall, half a metre in front of it: the corridor overlaps the building but does not lead through.
    const along: Vec2[] = [
      [-20, -0.5],
      [50, -0.5],
    ];
    expect(generateBuilding({ ...base, roads: [{ line: along, passage: true }] }).debug?.passages).toEqual(
      [],
    );
  });

  it('is deterministic', () => {
    for (const name of ['sharp-bend', 'parts-joint', 'round']) {
      const a = generateBuilding(scene(name).input);
      const b = generateBuilding(scene(name).input);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    }
  });

  it('never throws on odd roads', () => {
    const lines: Vec2[][] = [
      [
        [5, 5],
        [5, 5],
      ],
      [
        [Number.NaN, 0],
        [15, 40],
      ],
      [
        [15, Number.NEGATIVE_INFINITY],
        [15, Number.POSITIVE_INFINITY],
      ],
      // Exactly along a wall, and exactly through two corners.
      [
        [-10, 0],
        [40, 0],
      ],
      [
        [-10, -10 / 3],
        [60, 20],
      ],
      // Back and forth over itself.
      [
        [15, -20],
        [15, 30],
        [15, -20],
        [15.5, 30],
      ],
      // A loop inside the building.
      [
        [10, -20],
        [10, 6],
        [20, 6],
        [20, 3],
        [10, 3],
        [10, 6],
      ],
      // Many short segments.
      Array.from({ length: 60 }, (_, i): Vec2 => [10 + Math.sin(i) * 2, -10 + i * 0.5]),
    ];
    for (const outer of [rect(30, 10), rect(30, 30)]) {
      for (const line of lines) {
        for (const width of [0, 3.5, 500]) {
          const mesh = generateBuilding({
            ...scene('straight').input,
            footprint: { outer },
            roads: [{ line, width, passage: true }],
          });
          checkMesh(mesh);
        }
      }
      // All of them at once.
      checkMesh(
        generateBuilding({
          ...scene('straight').input,
          footprint: { outer },
          roads: lines.map((line) => ({ line, passage: true })),
        }),
      );
    }
  });
});
