import { distanceToRing, ringBounds } from '../geom/polygon';
import { type Vec2, cross, pointSegment, sub } from '../geom/vec2';
import type { BuildingInput, ResolvedSpec, Span, WallContext, WallSegment } from '../types';

/** Closer than this, a neighbour blocks doors and windows. */
export const BLOCK_DISTANCE = 1.5;
/** Closer than this, the wall is treated as a party wall. */
export const SHARED_DISTANCE = 0.15;
/** Below this footprint area a crossing road only makes a passage when it is flagged as one. */
export const PASSAGE_MIN_AREA = 300;
const STEP = 0.25;

function mergeSpans(
  flags: boolean[],
  step: number,
  length: number,
  height: number,
  minHeight: number,
): Span[] {
  const spans: Span[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      spans.push({
        from: Math.max(0, (start - 0.5) * step),
        to: Math.min(length, (i - 0.5) * step),
        height,
        minHeight,
      });
      start = -1;
    }
  }
  return spans;
}

/**
 * Stage 3. For every wall: where neighbours block it, and how much it faces a road.
 * See plan/pipeline/03-context.md.
 */
export function buildContext(input: BuildingInput, spec: ResolvedSpec, walls: WallSegment[]): WallContext[] {
  const neighbours = (input.neighbours ?? [])
    .filter((n) => n.footprint.outer.length >= 3)
    .map((n) => ({
      ring: n.footprint.outer,
      bounds: ringBounds(n.footprint.outer),
      height: n.height ?? Number.POSITIVE_INFINITY,
      minHeight: n.minHeight ?? 0,
    }))
    // A neighbour entirely above or below this building's walls does not touch them.
    .filter((n) => n.minHeight < spec.base + spec.wallHeight - 0.1 && n.height > spec.base + 0.1);
  const roads = (input.roads ?? []).filter((r) => r.line.length >= 2);

  return walls.map((wall) => {
    const samples = Math.max(1, Math.round(wall.length / STEP));
    const step = wall.length / samples;
    const blocked: Span[] = [];
    const shared: Span[] = [];
    const anyBlocked = new Array<boolean>(samples + 1).fill(false);

    for (const nb of neighbours) {
      // Quick reject on the bounding box.
      const minX = Math.min(wall.a[0], wall.b[0]) - BLOCK_DISTANCE;
      const maxX = Math.max(wall.a[0], wall.b[0]) + BLOCK_DISTANCE;
      const minY = Math.min(wall.a[1], wall.b[1]) - BLOCK_DISTANCE;
      const maxY = Math.max(wall.a[1], wall.b[1]) + BLOCK_DISTANCE;
      if (nb.bounds.minX > maxX || nb.bounds.maxX < minX || nb.bounds.minY > maxY || nb.bounds.maxY < minY)
        continue;

      const isBlocked = new Array<boolean>(samples + 1).fill(false);
      const isShared = new Array<boolean>(samples + 1).fill(false);
      let any = false;
      for (let i = 0; i <= samples; i++) {
        const along = i * step;
        // Probe slightly in front of the wall so a neighbour behind the building does not count.
        const p: Vec2 = [
          wall.a[0] + wall.dir[0] * along + wall.normal[0] * 0.05,
          wall.a[1] + wall.dir[1] * along + wall.normal[1] * 0.05,
        ];
        const d = distanceToRing(p, nb.ring);
        if (d < BLOCK_DISTANCE) {
          isBlocked[i] = true;
          anyBlocked[i] = true;
          any = true;
          if (d < SHARED_DISTANCE) isShared[i] = true;
        }
      }
      if (any) {
        blocked.push(...mergeSpans(isBlocked, step, wall.length, nb.height, nb.minHeight));
        shared.push(...mergeSpans(isShared, step, wall.length, nb.height, nb.minHeight));
      }
    }

    const openSamples = anyBlocked.filter((b) => !b).length;
    const openFraction = openSamples / (samples + 1);

    // Street score: facing a road and close to it.
    const mid: Vec2 = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];
    let streetScore = 0;
    for (const road of roads) {
      const kindFactor =
        road.kind === 'path' ? 0.5 : road.kind === 'rail' ? (spec.type === 'station' ? 0.6 : 0) : 1;
      if (kindFactor === 0) continue;
      for (let i = 0; i + 1 < road.line.length; i++) {
        const a = road.line[i] as Vec2;
        const b = road.line[i + 1] as Vec2;
        const { distance: d, t } = pointSegment(mid, a, b);
        if (d > 80 || d < 1e-6) continue;
        const q: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const facing = ((q[0] - mid[0]) * wall.normal[0] + (q[1] - mid[1]) * wall.normal[1]) / d;
        if (facing <= 0) continue;
        const score = facing * (1 / (1 + d / 15)) * kindFactor;
        if (score > streetScore) streetScore = score;
      }
    }
    streetScore *= openFraction;
    if (wall.ring > 0) streetScore *= 0.2;

    // Passages: a road crossing this wall. Small buildings only get one when the road is flagged.
    const passages: Span[] = [];
    for (const road of roads) {
      if (road.kind === 'rail') continue;
      if (!road.passage && spec.metrics.area < PASSAGE_MIN_AREA) continue;
      for (let i = 0; i + 1 < road.line.length; i++) {
        const p = road.line[i] as Vec2;
        const r = sub(road.line[i + 1] as Vec2, p);
        const den = cross(r, wall.dir);
        if (Math.abs(den) < 1e-9) continue;
        const t = cross(sub(wall.a, p), wall.dir) / den; // along the road segment, 0..1
        const u = cross(sub(wall.a, p), r) / den; // along the wall, metres
        if (t < 0 || t > 1 || u < 0 || u > wall.length) continue;
        const width = Math.min(wall.length - 0.6, Math.max(2.4, (road.width ?? 3.5) + 1));
        if (width < 1.8) continue;
        const from = Math.max(0.3, Math.min(wall.length - 0.3 - width, u - width / 2));
        const clear = road.kind === 'path' ? 2.8 : 3.8;
        if (!passages.some((s) => s.from < from + width && s.to > from)) {
          passages.push({ from, to: from + width, height: clear });
        }
      }
    }

    return { blocked, shared, passages, streetScore, openFraction, courtyard: wall.ring > 0 };
  });
}

/** True if the interval [from, to] on the wall is blocked over more than `fraction` of its width at height y. */
export function isBlocked(
  context: WallContext,
  from: number,
  to: number,
  y: number,
  fraction = 0.25,
): boolean {
  let covered = 0;
  for (const span of context.blocked) {
    if (y >= span.height || y < (span.minHeight ?? 0)) continue;
    const overlap = Math.min(to, span.to) - Math.max(from, span.from);
    if (overlap > 0) covered += overlap;
  }
  return covered > (to - from) * fraction;
}
