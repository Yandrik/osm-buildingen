import { distanceToRing, ringBounds } from '../geom/polygon';
import { type Vec2, pointSegment } from '../geom/vec2';
import type { BuildingInput, ResolvedSpec, Span, WallContext, WallSegment } from '../types';

/** Closer than this, a neighbour blocks doors and windows. */
export const BLOCK_DISTANCE = 1.5;
/** Closer than this, the wall is treated as a party wall. */
export const SHARED_DISTANCE = 0.15;
const STEP = 0.25;

function mergeSpans(flags: boolean[], step: number, length: number, height: number): Span[] {
  const spans: Span[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i] === true;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      spans.push({ from: Math.max(0, (start - 0.5) * step), to: Math.min(length, (i - 0.5) * step), height });
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
    }));
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
        blocked.push(...mergeSpans(isBlocked, step, wall.length, nb.height));
        shared.push(...mergeSpans(isShared, step, wall.length, nb.height));
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

    return { blocked, shared, streetScore, openFraction, courtyard: wall.ring > 0 };
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
    if (y >= span.height) continue;
    const overlap = Math.min(to, span.to) - Math.max(from, span.from);
    if (overlap > 0) covered += overlap;
  }
  return covered > (to - from) * fraction;
}
