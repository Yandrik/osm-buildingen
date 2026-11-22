import { type Vec2, cross, dot, normalize, pointSegment, sub } from '../geom/vec2';
import { getStylePack } from '../styles/registry';
import { evalCurve } from '../styles/types';
import type { BuildingInput, ResolvedSpec, Span, WallContext, WallSegment } from '../types';

/** A rail line further from the wall than this gets no platform roof. */
const MAX_DISTANCE = 25;
/** Sine of the largest angle between wall and rail that still counts as running along it. */
const PARALLEL = 0.42;
const MIN_WALL = 6;
/** Keep the platform edge this far from the track centre line. */
const TRACK_CLEARANCE = 1.8;

interface RailSide {
  /** Distance from the wall to the rail line, metres. */
  distance: number;
}

/** For each wall: the nearest rail line running along it on the outside, or null. */
export function railSides(input: BuildingInput, walls: readonly WallSegment[]): (RailSide | null)[] {
  const rails = (input.roads ?? []).filter((r) => r.kind === 'rail' && r.line.length >= 2);
  return walls.map((wall) => {
    if (rails.length === 0 || wall.ring !== 0 || wall.length < MIN_WALL) return null;
    const mid: Vec2 = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
    let best: RailSide | null = null;
    for (const rail of rails) {
      for (let i = 0; i + 1 < rail.line.length; i++) {
        const a = rail.line[i] as Vec2;
        const b = rail.line[i + 1] as Vec2;
        const { distance, t } = pointSegment(mid, a, b);
        if (distance > MAX_DISTANCE || distance < 1e-6) continue;
        if (Math.abs(cross(wall.dir, normalize(sub(b, a)))) > PARALLEL) continue;
        const q: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        // Measured along the wall's normal: the rail must be in front of the wall.
        const ahead = dot(sub(q, mid), wall.normal);
        if (ahead <= 0.5) continue;
        if (!best || ahead < best.distance) best = { distance: ahead };
      }
    }
    return best;
  });
}

/** Longest stretch of the wall without a neighbour in front of it. */
function longestOpen(length: number, blocked: readonly Span[]): [number, number] {
  const spans = blocked
    .filter((s) => (s.minHeight ?? 0) < 2)
    .map((s) => [s.from, s.to] as const)
    .sort((p, q) => p[0] - q[0]);
  let best: [number, number] = [0, 0];
  let at = 0;
  for (const [from, to] of [...spans, [length, length] as const]) {
    if (from - at > best[1] - best[0]) best = [at, from];
    at = Math.max(at, to);
  }
  return best;
}

/**
 * Platform roofs of a station: one roof on posts along every wall that a rail line
 * runs along, built as a `canopy` building fixed to that wall. Old stations get a
 * lean-to roof, new ones a flat slab (style `platform.leanTo`).
 * Returns inputs for the canopies; empty for anything that is not a station.
 */
export function platformRoofs(
  input: BuildingInput,
  spec: ResolvedSpec,
  walls: readonly WallSegment[],
  context: readonly WallContext[],
): BuildingInput[] {
  if (spec.type !== 'station') return [];
  const style = getStylePack(spec.packId).types.station.platform;
  if (!style) return [];
  const sides = railSides(input, walls);
  const eave = spec.base + spec.wallHeight;
  // The station is the only neighbour that matters: the canopy is fixed to it.
  const station = { footprint: { outer: spec.footprint.outer }, height: eave, sameGroup: true };
  const leanTo = evalCurve(style.leanTo, spec.era) >= 0.5;
  const out: BuildingInput[] = [];
  walls.forEach((wall, w) => {
    const side = sides[w];
    const ctx = context[w];
    if (!side || !ctx || spec.base > 0.5) return;
    const depth = Math.min(evalCurve(style.depth, spec.era), side.distance - TRACK_CLEARANCE);
    if (depth < 2.5) return;
    const [from, to] = longestOpen(wall.length, ctx.blocked);
    if (to - from < 4) return;
    const rise = leanTo ? Math.min(0.9, Math.max(0.45, depth * 0.16)) : 0;
    // Under the station's eave, so the roof meets the wall instead of cutting through the eave.
    const top = Math.min(evalCurve(style.height, spec.era) + rise, eave - 0.2);
    if (top - rise < 2.6) return;
    const along = (u: number): Vec2 => [wall.a[0] + wall.dir[0] * u, wall.a[1] + wall.dir[1] * u];
    const out0 = along(from);
    const out1 = along(to);
    const n = wall.normal;
    const far = (p: Vec2): Vec2 => [p[0] + n[0] * depth, p[1] + n[1] * depth];
    // Counter-clockwise: the wall runs with the station on its left, so walk it backwards.
    const ring: Vec2[] = [out1, out0, far(out0), far(out1)];
    const bearing = (Math.atan2(n[0], n[1]) * 180) / Math.PI;
    out.push({
      footprint: { outer: ring },
      type: 'canopy',
      height: Math.round(top * 1000) / 1000,
      levels: 1,
      roof: leanTo
        ? {
            shape: 'skillion',
            height: Math.round(rise * 1000) / 1000,
            direction: Math.round(bearing * 10) / 10,
          }
        : { shape: 'flat' },
      neighbours: [station],
      style: input.style,
      year: input.year,
      // Same plot as the station: era and colours match.
      groupKey: input.groupKey ?? `${input.seed}`,
      seed: `${input.seed}/platform${w}`,
      baseElevation: input.baseElevation,
      detail: input.detail,
    });
  });
  return out;
}
