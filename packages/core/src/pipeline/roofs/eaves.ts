import { orientedBox, perimeter, polygonArea, ringArea } from '../../geom/polygon';
import { type Vec2, cross, dot, sub } from '../../geom/vec2';
import type { ResolvedSpec, RoofFace, RoofGeometry, WallSegment } from '../../types';
import { buildWalls } from '../walls';

/*
 * Straight eaves over mapped buttresses. See plan/styles/worship.md.
 *
 * Careful mappers draw a church's buttresses into its outline: every bay ends in a
 * bump about a metre deep. A roof built on that outline gets a tooth over each of
 * them. Here the roof is built on the outline without the bumps, so its eave runs
 * straight along the wall; each buttress ends at the eave with a flat stone top.
 */

/** A bump sticks out at most this far, and is at most this wide. */
const MAX_DEPTH = 2.2;
const MAX_WIDTH = 3.2;
const MIN_VERTICES = 8;

export interface Eaves {
  /** The spec with the bumps taken out of its footprint; the roof is built on this. */
  spec: ResolvedSpec;
  walls: WallSegment[];
  /** The buttresses left out, each as its four corners (counter-clockwise, starting on the wall). */
  bumps: Vec2[][];
}

const unit = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};

/** The outline without buttress-sized bumps, or null when it has none. */
export function straightEaves(spec: ResolvedSpec): Eaves | null {
  let ring = spec.footprint.outer;
  if (ring.length < MIN_VERTICES || spec.roof.shape === 'flat') return null;
  const bumps: Vec2[][] = [];
  for (let found = true; found && ring.length >= MIN_VERTICES; ) {
    found = false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const at = (k: number): Vec2 => ring[(i + k + n) % n] as Vec2;
      const [before, a, b, c, d, after] = [at(-1), at(0), at(1), at(2), at(3), at(4)];
      const out = unit(a, b);
      const face = unit(b, c);
      const back = unit(c, d);
      if (
        Math.hypot(b[0] - a[0], b[1] - a[1]) > MAX_DEPTH ||
        Math.hypot(d[0] - c[0], d[1] - c[1]) > MAX_DEPTH
      )
        continue;
      if (Math.hypot(c[0] - b[0], c[1] - b[1]) > MAX_WIDTH) continue;
      // Out of the wall (a right turn), across the front (two left turns), back into the wall (a right turn).
      if (cross(unit(before, a), out) > -0.5 || cross(out, face) < 0.5) continue;
      if (cross(face, back) < 0.5 || cross(back, unit(d, after)) > -0.5) continue;
      // Its front runs along the wall behind it (which may turn a corner there: a diagonal corner buttress).
      if (dot(unit(a, d), face) < 0.9) continue;
      bumps.push([a, b, c, d]);
      const drop = new Set([(i + 1) % n, (i + 2) % n]);
      ring = ring.filter((_, k) => !drop.has(k));
      found = true;
      break;
    }
  }
  if (bumps.length === 0) return null;
  const footprint = { outer: ring, holes: spec.footprint.holes };
  const box = orientedBox(ring);
  const boxArea = 4 * box.halfLength * box.halfWidth;
  const straight: ResolvedSpec = {
    ...spec,
    footprint,
    metrics: {
      area: polygonArea(footprint),
      perimeter: perimeter(ring),
      box,
      rectangularity: boxArea > 0 ? Math.min(1, ringArea(ring) / boxArea) : 0,
    },
  };
  return { spec: straight, walls: buildWalls(straight), bumps };
}

/** Where on `host` the point lies (0..1 along it), or null when it is not on that wall. */
function along(p: Vec2, host: WallSegment): number | null {
  const v = sub(p, host.a);
  if (Math.abs(cross(host.dir, v)) > 0.02) return null;
  const t = dot(v, host.dir) / host.length;
  return t < -1e-4 || t > 1 + 1e-4 ? null : t;
}

/**
 * The roof built on the straightened outline, made to fit the real one:
 * - a flat stone top on every buttress, at the eave;
 * - the piece of gable wall above a buttress that stands against a gable end
 *   (the real outline has no wall there, the buttress is in the way);
 * - `breaks` answered for the real walls, which are stretches of the straight ones.
 * Call `trimBumps` after the walls got their tops.
 */
export function fitEaves(roof: RoofGeometry, eaves: Eaves, eave: number): RoofGeometry {
  const hosts = eaves.walls.filter((w) => w.ring === 0);
  const hostOf = (a: Vec2, b: Vec2): { host: WallSegment; from: number; to: number } | null => {
    for (const host of hosts) {
      const from = along(a, host);
      const to = from === null ? null : along(b, host);
      if (from !== null && to !== null && to > from) return { host, from, to };
    }
    return null;
  };
  const faces: RoofFace[] = [...roof.faces];
  for (const [a, b, c, d] of eaves.bumps as [Vec2, Vec2, Vec2, Vec2][]) {
    faces.push({
      points: [a, b, c, d].map((p) => [p[0], p[1], eave] as const),
      kind: 'flat',
      material: 'wall',
    });
    const on = hostOf(a, d);
    if (!on) continue;
    const { host, from, to } = on;
    const point = (t: number): Vec2 => [
      host.a[0] + (host.b[0] - host.a[0]) * t,
      host.a[1] + (host.b[1] - host.a[1]) * t,
    ];
    const ts = [from, ...roof.breaks(host).filter((t) => t > from + 1e-4 && t < to - 1e-4), to];
    const tops = ts.map((t) => Math.max(0, roof.heightAt(point(t))));
    if (!tops.some((h) => h > 1e-3)) continue;
    faces.push({
      points: [
        [a[0], a[1], eave],
        [d[0], d[1], eave],
        ...ts
          .map((t, k) => [point(t)[0], point(t)[1], eave + (tops[k] as number)] as const)
          .reverse()
          .filter((p) => p[2] > eave + 1e-3),
      ],
      kind: 'curved',
      material: 'wall',
    });
  }
  return {
    faces,
    outline: roof.outline,
    heightAt: roof.heightAt,
    breaks(wall: WallSegment): number[] {
      if (wall.ring !== 0) return roof.breaks(wall);
      const on = hostOf(wall.a, wall.b);
      if (!on) return [];
      return roof
        .breaks(on.host)
        .map((t) => (t - on.from) / (on.to - on.from))
        .filter((t) => t > 0 && t < 1);
    },
  };
}

/** The walls of the buttresses end at the eave, whatever the roof above the wall behind them does. */
export function trimBumps(walls: WallSegment[], eaves: Eaves): void {
  const hosts = eaves.walls.filter((w) => w.ring === 0);
  for (const wall of walls) {
    if (wall.ring !== 0) continue;
    const hosted = hosts.some((host) => along(wall.a, host) !== null && along(wall.b, host) !== null);
    if (!hosted) wall.top = [];
  }
}
