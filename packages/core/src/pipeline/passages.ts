import { type Colour, shade } from '../colour';
import { difference, intersection, union } from '../geom/boolean';
import {
  type Bounds2,
  type Polygon,
  type Ring,
  distanceToRing,
  perimeter,
  pointInPolygon,
  polygonArea,
  ringBounds,
  signedArea,
} from '../geom/polygon';
import { type Vec2, cross, distance, dot, normalize, pointSegment, sub } from '../geom/vec2';
import type { MeshBuilder } from '../mesh/builder';
import { TUNNEL_CEILING_SHADE, TUNNEL_WALL_SHADE } from '../pieces/arch';
import type {
  ArcadeKind,
  BuildingInput,
  Passage,
  PassageOpening,
  ResolvedSpec,
  RoadInput,
  Span,
  Vec3,
  WallSegment,
} from '../types';
import { buildWalls } from './walls';

/*
 * Passages: roads that run through a building at ground level.
 * See plan/pipeline/03-context.md, "Passages".
 *
 * The road line is buffered to a corridor and clipped to the footprint. A piece of
 * that is a passage when it really leads through: it touches the footprint boundary
 * in at least two separate stretches. Each stretch becomes an opening in the facade,
 * every other edge of the piece a tunnel wall, and the piece itself the ceiling.
 *
 * Arcades and colonnades (roads tagged `covered`, or a path running along the inside
 * of a facade) are the same corridor opened towards the outside: one opening is
 * enough, the strip between corridor and facade is taken in more generously, and the
 * clear height is the whole ground storey.
 */

/** Below this footprint area a crossing road only makes a passage when it is flagged as one. */
export const PASSAGE_MIN_AREA = 300;
/** Corridor width: road width plus this, within the limits below. */
const SIDE_ROOM = 1;
const MIN_WIDTH = 2.4;
/**
 * Widest corridor. Wider ways than this do not run through buildings: the width is a
 * class default (a pedestrian zone) or a wrong tag, and should not eat the ground floor.
 */
const MAX_WIDTH_ROAD = 8;
const MAX_WIDTH_PATH = 4.5;
const CLEAR_ROAD = 3.8;
const CLEAR_PATH = 2.8;
/** Lowest opening worth cutting. */
const MIN_CLEAR = 2.2;
/** What stays between the tunnel ceiling and the floor above; the thin one is for low ground levels. */
const SLAB = 0.3;
const THIN_SLAB = 0.12;
/** A boundary stretch narrower than this does not count as a way in or out. */
const MIN_OPENING = 1.2;
/** A road that ends this close to a wall is taken to lead through it. */
const END_SNAP = 1;
/** A road segment must run inside the footprint for at least this length to count. */
const MIN_INSIDE = 0.05;
/** Corridor pieces smaller or thinner (2 × area / perimeter) than this are clipping slivers. */
const MIN_AREA = 1.5;
const MIN_THICKNESS = 0.6;
/** What the corridor leaves standing must be at least this thick (2 × area / perimeter) to be a wall or pier. */
const MIN_PIER = 0.6;
/** A passage takes at most this share of the footprint. */
const MAX_SHARE = 0.5;
/** Tolerance for "this point lies on that wall". The clipper drops points up to 5 mm off a line. */
const ON_WALL = 0.02;
/** Component along the wall (of a unit vector) from which a tunnel wall counts as oblique. */
const LEAN = 0.02;
/** Narrowest arcade walk. */
const ARCADE_MIN_WIDTH = 3;
/** Clear height asked for by an arcade: more than any storey, so the ground storey limits it. */
const ARCADE_CLEAR = 99;
/** Building left between an arcade corridor and the facade below this thickness is opened up too. */
const ARCADE_STRIP = 2.2;
/**
 * An untagged path counts as an arcade when its corridor opens a single wall over at
 * least this length and this share of the wall: it runs along the facade, not through it.
 */
const ARCADE_MIN_RUN = 6;
const ARCADE_MIN_SHARE = 0.6;
/** A tagged covered way may take more of the footprint: the house really stands over it. */
const COVERED_MAX_SHARE = 0.85;
/** A wall with a neighbour within this distance in front of it opens into that neighbour, not outside. */
const NEIGHBOUR_GAP = 0.5;
/** Step for probing a wall for neighbours. */
const PROBE = 0.25;
/** An opening into a neighbour longer than this runs along it rather than leading into it. */
const ALONG_NEIGHBOUR = 6;

/** A corridor piece known to lead through a building, and the clear height its roads ask for. */
export interface Corridor {
  polygon: Polygon;
  clear: number;
  arcade?: ArcadeKind;
  /** One arch per run of straight walls (see splitAtCorners). */
  perWall?: boolean;
}

/** A road line that may lead through the building, with half the corridor width and the clear height it asks for. */
interface Way {
  line: Vec2[];
  hw: number;
  clear: number;
  arcade: ArcadeKind | undefined;
  path: boolean;
  covered: boolean;
}

interface Sample {
  p: Vec2;
  clear: number;
  arcade: ArcadeKind | undefined;
  path: boolean;
  covered: boolean;
}

interface SubEdge {
  a: Vec2;
  b: Vec2;
  /** Wall the edge lies on, or -1 for an edge inside the building. */
  wall: number;
  from: number;
  to: number;
}

interface Stretch {
  length: number;
  parts: PassageOpening[];
}

interface Shape {
  stretches: Stretch[];
  sides: [Vec2, Vec2][];
}

interface Found extends Corridor {
  shape: Shape;
}

const apart = (a: Bounds2, b: Bounds2): boolean =>
  a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY;

function cleanLine(line: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > 1e-3) out.push(p);
  }
  return out;
}

/** The roads that may make a passage: not rails, flagged or through a large building, and near the footprint. */
function candidateWays(roads: readonly RoadInput[], area: number, box: Bounds2): Way[] {
  const ways: Way[] = [];
  for (const road of roads) {
    if (road.kind === 'rail' || road.line.length < 2) continue;
    const covered = road.covered !== undefined;
    const arcade = road.covered === 'yes' ? undefined : road.covered;
    if (!road.passage && !covered && area < PASSAGE_MIN_AREA) continue;
    const line = cleanLine(road.line);
    if (line.length < 2 || apart(ringBounds(line), box)) continue;
    const path = road.kind === 'path';
    const widest = path ? MAX_WIDTH_PATH : MAX_WIDTH_ROAD;
    const narrowest = arcade ? ARCADE_MIN_WIDTH : MIN_WIDTH;
    ways.push({
      line,
      hw: Math.min(widest, Math.max(narrowest, (road.width ?? 3.5) + SIDE_ROOM)) / 2,
      clear: arcade ? ARCADE_CLEAR : path ? CLEAR_PATH : CLEAR_ROAD,
      arcade,
      path,
      covered,
    });
  }
  return ways;
}

/**
 * Joins ways that continue each other. Map data splits a road wherever its tags
 * change, typically right at the walls of a passage; buffered one by one, the pieces
 * would meet with two flat ends instead of a mitred bend. Only plain continuations
 * are joined: two ends at one point, same width and height.
 */
function joinWays(ways: Way[]): Way[] {
  const near = (a: Vec2, b: Vec2): boolean => distance(a, b) < 0.05;
  const ends = (w: Way): [Vec2, Vec2] => [w.line[0] as Vec2, w.line[w.line.length - 1] as Vec2];
  const out = [...ways];
  for (let again = true; again; ) {
    again = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i] as Way;
        const b = out[j] as Way;
        if (a.hw !== b.hw || a.clear !== b.clear || a.arcade !== b.arcade) continue;
        for (const [ea, pa] of ends(a).entries()) {
          for (const [eb, pb] of ends(b).entries()) {
            if (!near(pa, pb)) continue;
            // A third way ending here makes it a junction; a way meeting itself, a loop.
            const meeting = out.reduce((n, w) => n + ends(w).filter((p) => near(p, pa)).length, 0);
            if (meeting !== 2) continue;
            const first = ea === 1 ? a.line : [...a.line].reverse();
            const second = eb === 0 ? b.line : [...b.line].reverse();
            out[i] = { ...a, line: [...first, ...second.slice(1)] };
            out.splice(j, 1);
            again = true;
            break search;
          }
        }
      }
    }
  }
  return out;
}

/** Union of the corridor rectangles, or null when the clipper cannot do it. */
function mergeRects(rects: Polygon[]): Polygon[] | null {
  if (rects.length === 1) return rects;
  const all = union(rects);
  if (all) return all;
  // The clipper sometimes fails on many nearly coincident edges at once; adding one at a time can still work.
  let merged: Polygon[] = [rects[0] as Polygon];
  for (let i = 1; i < rects.length; i++) {
    const next = union([...merged, rects[i] as Polygon]);
    if (!next) return null;
    merged = next;
  }
  return merged;
}

/** Length of the segment a-b inside the footprint, and the middle of each inside run. */
function insideRuns(
  a: Vec2,
  b: Vec2,
  footprint: Polygon,
  rings: readonly Ring[],
): { length: number; mids: Vec2[] } {
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1]);
  const ts = [0, 1];
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i] as Vec2;
      const e = sub(ring[(i + 1) % n] as Vec2, p);
      const den = cross(d, e);
      if (Math.abs(den) < 1e-12) continue;
      const t = cross(sub(p, a), e) / den;
      const u = cross(sub(p, a), d) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  let length = 0;
  const mids: Vec2[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] as number;
    const t1 = ts[i + 1] as number;
    if ((t1 - t0) * len < 1e-6) continue;
    const m = (t0 + t1) / 2;
    const mid: Vec2 = [a[0] + d[0] * m, a[1] + d[1] * m];
    if (!pointInPolygon(mid, footprint)) continue;
    length += (t1 - t0) * len;
    mids.push(mid);
  }
  return { length, mids };
}

/** Distance from p along the unit vector dir to the footprint boundary. */
function rayToBoundary(p: Vec2, dir: Vec2, rings: readonly Ring[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const q = ring[i] as Vec2;
      const e = sub(ring[(i + 1) % n] as Vec2, q);
      const den = cross(dir, e);
      if (Math.abs(den) < 1e-12) continue;
      const t = cross(sub(q, p), e) / den;
      const u = cross(sub(q, p), dir) / den;
      // A road ending exactly on the outline must find that edge, hence the slack behind p.
      if (u < -1e-9 || u > 1 + 1e-9 || t < -1e-6) continue;
      if (t < best) best = Math.max(0, t);
    }
  }
  return best;
}

/**
 * Adds the corridor of one road as rectangles, one per segment that runs inside the
 * footprint; their union is the buffered line. Joints are mitred by lengthening both
 * rectangles, which is exact up to a right angle; sharper bends get a filler triangle.
 *
 * Ends are flat. An end outside the footprint (or within END_SNAP of leaving it) is
 * pushed further out, so the corridor leaves through the wall with its full width
 * even when it crosses at an angle. An end well inside stays where it is: the road
 * is a dead end, and the piece it gives will be rejected for having one opening.
 */
function roadRects(
  way: Way,
  footprint: Polygon,
  rings: readonly Ring[],
  box: Bounds2,
  rects: Polygon[],
  samples: Sample[],
): void {
  const { line, hw, clear, arcade, path, covered } = way;
  const n = line.length - 1;
  const dirs: Vec2[] = [];
  const included: boolean[] = [];
  let any = false;
  for (let k = 0; k < n; k++) {
    const a = line[k] as Vec2;
    const b = line[k + 1] as Vec2;
    dirs.push(normalize(sub(b, a)));
    let inside = false;
    if (!apart(ringBounds([a, b]), box)) {
      const runs = insideRuns(a, b, footprint, rings);
      inside = runs.length > MIN_INSIDE;
      if (inside) for (const p of runs.mids) samples.push({ p, clear, arcade, path, covered });
    }
    included.push(inside);
    any ||= inside;
  }
  if (!any) return;

  const reach = 2 * hw + 1;
  const endExtension = (p: Vec2, dir: Vec2): number => {
    if (!pointInPolygon(p, footprint)) return reach;
    const s = rayToBoundary(p, dir, rings);
    return s <= END_SNAP ? s + reach : 0;
  };
  /** How far both rectangles at the joint after segment k reach past it. */
  const mitre = (k: number): number => {
    const c = dot(dirs[k] as Vec2, dirs[k + 1] as Vec2);
    if (c <= 1e-6) return hw;
    return hw * Math.min(1, Math.abs(cross(dirs[k] as Vec2, dirs[k + 1] as Vec2)) / (1 + c));
  };

  for (let k = 0; k < n; k++) {
    if (!included[k]) continue;
    const a = line[k] as Vec2;
    const b = line[k + 1] as Vec2;
    const d = dirs[k] as Vec2;
    const joinsBefore = k > 0 && included[k - 1] === true;
    const joinsAfter = k + 1 < n && included[k + 1] === true;
    const back = joinsBefore ? mitre(k - 1) : endExtension(a, [-d[0], -d[1]]);
    const fwd = joinsAfter ? mitre(k) : endExtension(b, d);
    const a2: Vec2 = [a[0] - d[0] * back, a[1] - d[1] * back];
    const b2: Vec2 = [b[0] + d[0] * fwd, b[1] + d[1] * fwd];
    // Right-hand normal, so the rectangle comes out counter-clockwise.
    const r: Vec2 = [d[1] * hw, -d[0] * hw];
    rects.push({
      outer: [
        [a2[0] + r[0], a2[1] + r[1]],
        [b2[0] + r[0], b2[1] + r[1]],
        [b2[0] - r[0], b2[1] - r[1]],
        [a2[0] - r[0], a2[1] - r[1]],
      ],
    });
    if (joinsAfter && dot(d, dirs[k + 1] as Vec2) <= 1e-6) {
      // Sharper than a right angle: the two rectangles leave a notch on the outside of the bend.
      const e = dirs[k + 1] as Vec2;
      const side = cross(d, e) >= 0 ? hw : -hw;
      const tri: Vec2[] = [
        b,
        [b[0] + d[0] * hw + d[1] * side, b[1] + d[1] * hw - d[0] * side],
        [b[0] - e[0] * hw + e[1] * side, b[1] - e[1] * hw - e[0] * side],
      ];
      if (Math.abs(signedArea(tri)) > 1e-4) rects.push({ outer: signedArea(tri) > 0 ? tri : tri.reverse() });
    }
  }
}

/** Splits a ring of a corridor piece at footprint corners and says for each edge which wall it lies on. */
function classifyRing(ring: Ring, walls: readonly WallSegment[]): SubEdge[] {
  const box = ringBounds(ring);
  // Only walls near the piece can carry one of its edges.
  const near: number[] = [];
  walls.forEach((w, i) => {
    if (
      Math.max(w.a[0], w.b[0]) >= box.minX - ON_WALL &&
      Math.min(w.a[0], w.b[0]) <= box.maxX + ON_WALL &&
      Math.max(w.a[1], w.b[1]) >= box.minY - ON_WALL &&
      Math.min(w.a[1], w.b[1]) <= box.maxY + ON_WALL
    )
      near.push(i);
  });

  const out: SubEdge[] = [];
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const len = distance(p, q);
    // The clipper merges collinear edges, so one edge may run along a wall and on into
    // the building. Cutting at every footprint corner on the edge separates the two.
    const cuts: { t: number; v: Vec2 }[] = [];
    for (const w of near) {
      const v = (walls[w] as WallSegment).a;
      const hit = pointSegment(v, p, q);
      if (hit.distance < ON_WALL && hit.t * len > ON_WALL && (1 - hit.t) * len > ON_WALL)
        cuts.push({ t: hit.t, v });
    }
    cuts.sort((x, y) => x.t - y.t);
    let a = p;
    for (const cut of [...cuts, { t: 1, v: q }]) {
      const b = cut.v;
      if (distance(a, b) < 1e-3 && cut.t < 1) continue;
      let wall = -1;
      let from = 0;
      let to = 0;
      let best = 1e-3;
      for (const w of near) {
        const s = walls[w] as WallSegment;
        if (pointSegment(a, s.a, s.b).distance > ON_WALL || pointSegment(b, s.a, s.b).distance > ON_WALL)
          continue;
        const ua = dot(sub(a, s.a), s.dir);
        const ub = dot(sub(b, s.a), s.dir);
        if (Math.abs(ub - ua) <= best) continue;
        best = Math.abs(ub - ua);
        wall = w;
        from = Math.max(0, Math.min(ua, ub));
        to = Math.min(s.length, Math.max(ua, ub));
      }
      out.push({ a, b, wall, from, to });
      a = b;
    }
  }
  return out;
}

/** Openings and tunnel walls of a corridor piece that lies inside the footprint. */
function analyse(piece: Polygon, walls: readonly WallSegment[]): Shape {
  const stretches: Stretch[] = [];
  const sides: [Vec2, Vec2][] = [];
  /** Interior angle above 180°: the wall thicknesses of the two walls do not meet. */
  const reflex = (w0: number, w1: number): boolean =>
    cross((walls[w0] as WallSegment).dir, (walls[w1] as WallSegment).dir) < -LEAN;

  for (const ring of [piece.outer, ...(piece.holes ?? [])]) {
    const edges = classifyRing(ring, walls);
    const n = edges.length;
    for (const e of edges) if (e.wall < 0) sides.push([e.a, e.b]);
    const firstInside = edges.findIndex((e) => e.wall < 0);
    // Walk the ring starting behind an inside edge, so no stretch is cut in two by the start.
    const start = firstInside < 0 ? 0 : firstInside + 1;
    let run: SubEdge[] = [];
    for (let k = 0; k <= n; k++) {
      const e = k < n ? (edges[(start + k) % n] as SubEdge) : null;
      if (e && e.wall >= 0) {
        run.push(e);
        continue;
      }
      if (run.length === 0) continue;
      const closed = firstInside < 0;
      const before = closed ? null : (edges[(start + k - run.length - 1 + 2 * n) % n] as SubEdge);
      const after = closed ? null : e;

      // One opening per wall, in order along the boundary.
      const parts: PassageOpening[] = [];
      for (const s of run) {
        const last = parts[parts.length - 1];
        if (last && last.wall === s.wall && s.from <= last.to + ON_WALL) {
          last.to = Math.max(last.to, s.to);
          continue;
        }
        parts.push({
          wall: s.wall,
          from: s.from,
          to: s.to,
          openFrom: 0,
          openTo: 0,
          capFrom: false,
          capTo: false,
        });
      }
      const length = parts.reduce((sum, p) => sum + (p.to - p.from), 0);
      let offset = 0;
      parts.forEach((p, i) => {
        p.openFrom = p.from - offset;
        p.openTo = p.openFrom + length;
        offset += p.to - p.from;
        const next = parts[i + 1];
        if (next && reflex(p.wall, next.wall)) {
          p.capTo = true;
          next.capFrom = true;
        }
      });
      const first = parts[0] as PassageOpening;
      const last = parts[parts.length - 1] as PassageOpening;
      if (before) {
        // The tunnel wall leaves the start of the opening along `before`, backwards.
        const away = normalize(sub(before.a, before.b));
        first.capFrom = dot(away, (walls[first.wall] as WallSegment).dir) < -LEAN;
      }
      if (after) {
        const away = normalize(sub(after.b, after.a));
        last.capTo = dot(away, (walls[last.wall] as WallSegment).dir) > LEAN;
      }
      if (closed && parts.length > 1 && reflex(last.wall, first.wall)) {
        last.capTo = true;
        first.capFrom = true;
      }
      stretches.push({ length, parts });
      run = [];
    }
  }
  return { stretches, sides };
}

const thickness = (piece: Polygon): number => (2 * polygonArea(piece)) / perimeter(piece.outer);
/** A stretch of an opening that is either open to the outside or faces a neighbour. */
interface Run {
  length: number;
  wall: number;
  free: boolean;
}

/**
 * The openings cut into runs where a neighbour does or does not stand in front of the
 * wall. An opening against a neighbour leads into that house (a row of houses with one
 * passage), unless it runs along it: then the corridor merely follows the party wall.
 */
function openRuns(shape: Shape, walls: readonly WallSegment[], neighbours: readonly Ring[]): Run[][] {
  const near = (wall: WallSegment, u: number): boolean => {
    const p: Vec2 = [
      wall.a[0] + wall.dir[0] * u + wall.normal[0] * 0.05,
      wall.a[1] + wall.dir[1] * u + wall.normal[1] * 0.05,
    ];
    return neighbours.some((ring) => distanceToRing(p, ring) < NEIGHBOUR_GAP);
  };
  return shape.stretches.map((s) => {
    const runs: Run[] = [];
    for (const part of s.parts) {
      const wall = walls[part.wall] as WallSegment;
      const len = part.to - part.from;
      const n = Math.max(1, Math.ceil(len / PROBE));
      for (let i = 0; i < n; i++) {
        const free = !near(wall, part.from + (len * (i + 0.5)) / n);
        const last = runs[runs.length - 1];
        if (last && last.free === free && (free || last.wall === part.wall)) last.length += len / n;
        else runs.push({ length: len / n, wall: part.wall, free });
      }
    }
    return runs;
  });
}

/** Ways out of the corridor: open runs, and runs that lead into a neighbour rather than along it. */
const exits = (runs: readonly Run[][]): number =>
  runs.flat().filter((r) => r.length >= MIN_OPENING && (r.free || r.length <= ALONG_NEIGHBOUR)).length;

/** A single open run along one wall for most of its length: the corridor follows the facade. */
function runsAlongWall(runs: readonly Run[][], walls: readonly WallSegment[]): boolean {
  return runs
    .flat()
    .some(
      (r) =>
        r.free &&
        r.length >= ARCADE_MIN_RUN &&
        r.length >= ARCADE_MIN_SHARE * (walls[r.wall] as WallSegment).length,
    );
}

const isSliver = (piece: Polygon): boolean =>
  polygonArea(piece) < MIN_AREA || thickness(piece) < MIN_THICKNESS;

/**
 * A corridor running just inside a wall would leave a paper-thin strip of building
 * between itself and the outside. Such leftovers are added to the corridor piece, so
 * that side is open instead. (Which usually means the piece is no passage at all: a
 * footway under an arcade, or along a house whose outline is drawn too wide.)
 * Returns null when the clipper fails.
 */
function absorbThinWalls(piece: Polygon, footprint: Polygon, limit = MIN_PIER): Polygon | null {
  const rest = difference(footprint, [piece]);
  if (!rest) return null;
  // Only strips: a whole small building part left beside the corridor stays.
  const thin = rest.filter((r) => thickness(r) < limit && polygonArea(r) < 0.5 * polygonArea(footprint));
  if (thin.length === 0) return piece;
  const merged = union([piece, ...thin]);
  if (!merged) return null;
  // Every leftover touches the piece, so this is one polygon; if not, leave the piece as it was.
  return merged.length === 1 ? (merged[0] as Polygon) : piece;
}

/**
 * The corridors of all roads that really lead through the footprint.
 * `walls` is only asked for once a road has turned out to run inside the footprint.
 */
function throughCorridors(
  roads: readonly RoadInput[],
  footprint: Polygon,
  area: number,
  walls: () => readonly WallSegment[],
  notes: string[],
  implied: ArcadeKind,
  neighbours: readonly Ring[],
): Found[] {
  const rings = [footprint.outer, ...(footprint.holes ?? [])];
  const box = ringBounds(footprint.outer);
  let ways = candidateWays(roads, area, box);
  if (ways.length === 0) return [];
  if (ways.length > 1) ways = joinWays(ways);
  const rects: Polygon[] = [];
  const samples: Sample[] = [];
  for (const way of ways) roadRects(way, footprint, rings, box, rects, samples);
  if (rects.length === 0) return [];

  // Overlapping corridors (two roads meeting inside, a bend) become one tunnel.
  const merged = mergeRects(rects);
  if (!merged) {
    notes.push('passage: could not merge the road corridors, none cut');
    return [];
  }
  const out: Found[] = [];
  for (const corridor of merged) {
    const pieces = intersection(corridor, footprint);
    if (!pieces) {
      notes.push('passage: could not clip a road corridor to the footprint, not cut');
      continue;
    }
    for (const clipped of pieces) {
      // Mostly corridor: a gate, a roof or a kiosk standing in the way rather than a house with a passage.
      if (isSliver(clipped)) continue;
      // A piece no road line runs through is the far end of a lengthened corridor, or its edge clipping a corner.
      let clear = 0;
      let arcade: ArcadeKind | undefined;
      let path = false;
      let covered = false;
      for (const s of samples) {
        if (!pointInPolygon(s.p, clipped)) continue;
        if (s.clear > clear) clear = s.clear;
        arcade ??= s.arcade;
        path ||= s.path;
        covered ||= s.covered;
      }
      if (clear === 0) continue;
      const share = covered ? COVERED_MAX_SHARE : MAX_SHARE;
      if (polygonArea(clipped) > share * area) continue;
      const piece = absorbThinWalls(clipped, footprint, arcade ? ARCADE_STRIP : MIN_PIER);
      if (!piece) {
        notes.push('passage: could not clean up a road corridor, not cut');
        continue;
      }
      if (polygonArea(piece) > share * area) continue;
      const shape = analyse(piece, walls());
      const openings = shape.stretches.filter((s) => s.length >= MIN_OPENING).length;
      if (arcade) {
        if (openings === 0) continue;
      } else if (openings < 2) {
        if (openings === 0) continue;
        const runs = openRuns(shape, walls(), neighbours);
        // Along a party wall the corridor may touch the outline from end to end and still
        // be a passage: in from the street, along the neighbour, out at the back.
        if (exits(runs) < 2) {
          // A footway along the inside of a facade, open to the street: an arcade nobody tagged.
          if (!path || !runsAlongWall(runs, walls())) continue;
          arcade = implied;
          clear = ARCADE_CLEAR;
        } else {
          out.push({ polygon: piece, clear, shape, perWall: true });
          continue;
        }
      }
      out.push({ polygon: piece, clear, shape, ...(arcade ? { arcade } : {}) });
    }
  }
  return out;
}

/** Corridors already found for the whole building, cut down to one of its parts. */
function clipCorridors(
  given: readonly Corridor[],
  footprint: Polygon,
  walls: readonly WallSegment[],
  notes: string[],
): Found[] {
  const box = ringBounds(footprint.outer);
  const out: Found[] = [];
  for (const corridor of given) {
    if (apart(ringBounds(corridor.polygon.outer), box)) continue;
    const pieces = intersection(corridor.polygon, footprint);
    if (!pieces) {
      notes.push('passage: could not clip a road corridor to the footprint, not cut');
      continue;
    }
    for (const clipped of pieces) {
      if (isSliver(clipped)) continue;
      const piece = absorbThinWalls(clipped, footprint, corridor.arcade ? ARCADE_STRIP : MIN_PIER);
      if (!piece) {
        notes.push('passage: could not clean up a road corridor, not cut');
        continue;
      }
      const shape = analyse(piece, walls);
      // Without any opening the piece would be a sealed room.
      if (shape.stretches.length > 0)
        out.push({
          polygon: piece,
          clear: corridor.clear,
          shape,
          ...(corridor.arcade ? { arcade: corridor.arcade } : {}),
          ...(corridor.perWall ? { perWall: true } : {}),
        });
    }
  }
  return out;
}

/**
 * Arcade style for a path found running along the facade without a tag: round arches
 * on older buildings, columns under a beam on newer ones.
 */
const impliedArcade = (spec: ResolvedSpec): ArcadeKind => (spec.era < 0.5 ? 'arcade' : 'colonnade');

const neighbourRings = (input: BuildingInput): Ring[] =>
  (input.neighbours ?? []).filter((n) => n.footprint.outer.length >= 3).map((n) => n.footprint.outer);

/**
 * Corridors through a building that is built from parts, found on its outline.
 * The parts are cut with these instead of looking at the roads themselves, so a
 * passage is judged once for the whole building and comes out continuous.
 */
export function buildingCorridors(input: BuildingInput, spec: ResolvedSpec): Corridor[] {
  if (!input.roads || input.roads.length === 0) return [];
  let walls: WallSegment[] | null = null;
  return throughCorridors(
    input.roads,
    spec.footprint,
    spec.metrics.area,
    () => {
      walls ??= buildWalls(spec);
      return walls;
    },
    spec.notes,
    impliedArcade(spec),
    neighbourRings(input),
  ).map((f) => ({
    polygon: f.polygon,
    clear: f.clear,
    ...(f.arcade ? { arcade: f.arcade } : {}),
    ...(f.perWall ? { perWall: true } : {}),
  }));
}

/**
 * The passages of one building volume: where roads lead through it, how high the
 * tunnel is and where it opens through the walls. `given` replaces the roads with
 * corridors that are already known to lead through (parts of a building).
 */
export function findPassages(
  input: BuildingInput,
  spec: ResolvedSpec,
  walls: readonly WallSegment[],
  given?: readonly Corridor[],
): Passage[] {
  // A volume that starts above the ground (bridge, tower top) has nothing to cut;
  // a canopy has no walls to cut through.
  if (spec.base >= 0.5 || (spec.type as string) === 'canopy') return [];
  if (given ? given.length === 0 : !input.roads || input.roads.length === 0) return [];
  const found = given
    ? clipCorridors(given, spec.footprint, walls, spec.notes)
    : throughCorridors(
        input.roads ?? [],
        spec.footprint,
        spec.metrics.area,
        () => walls,
        spec.notes,
        impliedArcade(spec),
        neighbourRings(input),
      );
  if (found.length === 0) return [];

  const ground = spec.levelHeights[0] ?? 0;
  const fits = (clear: number, slab: number): number => Math.min(clear, ground - slab);
  const out: Passage[] = [];
  for (const f of found) {
    let clearHeight = fits(f.clear, SLAB);
    if (clearHeight < MIN_CLEAR) clearHeight = fits(f.clear, THIN_SLAB);
    if (clearHeight < MIN_CLEAR) {
      spec.notes.push(`passage: ground level of ${ground.toFixed(1)} m is too low for an opening, not cut`);
      continue;
    }
    const openings = f.shape.stretches.flatMap((s) => s.parts);
    if (f.arcade) {
      // Bays are laid out wall by wall.
      for (const o of openings) {
        o.openFrom = o.from;
        o.openTo = o.to;
      }
    } else if (f.perWall) {
      for (const s of f.shape.stretches) splitAtCorners(s.parts, walls);
    }
    out.push({
      polygon: [...f.polygon.outer],
      holes: (f.polygon.holes ?? []).map((h) => [...h]),
      clearHeight,
      openings,
      sides: f.shape.sides,
      ...(f.arcade ? { arcade: f.arcade } : {}),
    });
  }
  return out;
}

/** Walls meeting at less than this turn (cosine) carry one arch together. */
const STRAIGHT_ON = 0.87;

/**
 * Gives each run of nearly collinear walls of an opening its own arch: a passage that
 * enters from the street and then follows a party wall should not hang one long arch
 * around the corner, but a wall split by a node in the street front keeps one arch.
 */
function splitAtCorners(parts: PassageOpening[], walls: readonly WallSegment[]): void {
  let group: PassageOpening[] = [];
  const flush = (): void => {
    const length = group.reduce((sum, p) => sum + (p.to - p.from), 0);
    let offset = 0;
    for (const p of group) {
      p.openFrom = p.from - offset;
      p.openTo = p.openFrom + length;
      offset += p.to - p.from;
    }
    group = [];
  };
  for (const p of parts) {
    const last = group[group.length - 1];
    if (
      last &&
      dot((walls[last.wall] as WallSegment).dir, (walls[p.wall] as WallSegment).dir) < STRAIGHT_ON
    ) {
      last.capTo = true;
      p.capFrom = true;
      flush();
    }
    group.push(p);
  }
  flush();
}

/**
 * Tunnel walls (facing into the tunnel) and ceiling (facing down) of the passages.
 * No floor: the caller draws the ground and the road.
 */
export function addTunnels(
  mb: MeshBuilder,
  passages: readonly Passage[],
  world: (p: Vec2, h: number) => Vec3,
  wall: Colour,
  glass: Colour,
): void {
  const side = shade(wall, TUNNEL_WALL_SHADE);
  const ceiling = shade(wall, TUNNEL_CEILING_SHADE);
  for (const p of passages) {
    const h = p.clearHeight;
    // The inside of the piece is on the left of each edge, so the face is wound backwards.
    for (const [a, b] of p.sides) {
      mb.quad(world(b, 0), world(a, 0), world(a, h), world(b, h), side);
      // Behind an arcade lies the real ground-floor front: shop windows along it.
      if (p.arcade) shopWindows(mb, a, b, h, world, glass);
    }
    const at = (q: Vec2): Vec3 => world(q, h);
    mb.polygon(
      [...p.polygon].reverse().map(at),
      ceiling,
      p.holes.map((hole) => [...hole].reverse().map(at)),
    );
  }
}

const SHOP_BAY = 2.6;
const SHOP_PIER = 0.25;
const SHOP_SILL = 0.25;
const SHOP_HEAD = 0.5;
const SHOP_PROUD = 0.02;

/** Glazed panes along the back wall of an arcade walk, from a to b (walk on the left). */
function shopWindows(
  mb: MeshBuilder,
  a: Vec2,
  b: Vec2,
  clear: number,
  world: (p: Vec2, h: number) => Vec3,
  glass: Colour,
): void {
  const len = distance(a, b);
  const top = Math.min(clear - SHOP_HEAD, 2.8);
  if (len < 1.6 || top - SHOP_SILL < 1) return;
  const d = normalize(sub(b, a));
  const n: Vec2 = [-d[1] * SHOP_PROUD, d[0] * SHOP_PROUD];
  const at = (u: number): Vec2 => [a[0] + d[0] * u + n[0], a[1] + d[1] * u + n[1]];
  const count = Math.max(1, Math.round(len / SHOP_BAY));
  const bay = len / count;
  for (let i = 0; i < count; i++) {
    const p = at(i * bay + SHOP_PIER);
    const q = at((i + 1) * bay - SHOP_PIER);
    mb.quad(world(q, SHOP_SILL), world(p, SHOP_SILL), world(p, top), world(q, top), glass);
  }
}

/**
 * A wall without facade cells (massing detail) around rectangular passage openings.
 * `rect` draws one rectangle given along-the-wall and height ranges.
 */
export function wallWithOpenings(
  spans: readonly Span[],
  length: number,
  height: number,
  rect: (u0: number, v0: number, u1: number, v1: number) => void,
): void {
  let done = 0;
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const u0 = Math.max(done, s.from);
    const u1 = Math.min(length, s.to);
    if (u1 - u0 < 1e-4) continue;
    rect(done, 0, u0, height);
    rect(u0, Math.min(height, s.height), u1, height);
    done = u1;
  }
  rect(done, 0, length, height);
}
