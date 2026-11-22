import {
  difference as clipDifference,
  intersection as clipIntersection,
  union as clipUnion,
} from 'polyclip-ts';
import { type Polygon, cleanRing, ringArea } from './polygon';
import type { Vec2 } from './vec2';

/**
 * Polygon boolean operations.
 *
 * This is the only place that uses `polyclip-ts` (a Martinez-Rueda implementation
 * with exact arithmetic). Writing a robust clipper is a project of its own, and
 * building parts share edges and vertices with their outline all the time, which
 * is exactly where naive clippers break. Everything here returns clean polygons
 * in core's convention: open rings, outer counter-clockwise, holes clockwise.
 */

type ClipRing = [number, number][];
type ClipPolygon = ClipRing[];

/** Snap to 0.1 mm so nearly-equal coordinates from different sources coincide. */
const snap = (v: number): number => Math.round(v * 10000) / 10000;

function toClip(polygon: Polygon): ClipPolygon {
  const ring = (r: readonly Vec2[]): ClipRing => r.map((p) => [snap(p[0]), snap(p[1])]);
  return [ring(polygon.outer), ...(polygon.holes ?? []).map(ring)];
}

function fromClip(result: ClipPolygon[], minArea: number): Polygon[] {
  const out: Polygon[] = [];
  for (const poly of result) {
    const outerRaw = poly[0];
    if (!outerRaw) continue;
    const outer = cleanRing(outerRaw, true, 0.005);
    if (outer.length < 3 || ringArea(outer) < minArea) continue;
    const holes: Vec2[][] = [];
    for (let i = 1; i < poly.length; i++) {
      const hole = cleanRing(poly[i] as ClipRing, false, 0.005);
      if (hole.length >= 3 && ringArea(hole) >= minArea) holes.push(hole);
    }
    out.push(holes.length > 0 ? { outer, holes } : { outer });
  }
  return out;
}

/**
 * `subject` minus all `clips`. Returns null when the operation fails
 * (degenerate input), so callers can fall back instead of crashing.
 */
export function difference(subject: Polygon, clips: readonly Polygon[], minArea = 0.05): Polygon[] | null {
  if (clips.length === 0) return [subject];
  try {
    const [first, ...rest] = clips.map(toClip);
    return fromClip(clipDifference(toClip(subject), first as ClipPolygon, ...rest) as ClipPolygon[], minArea);
  } catch {
    return null;
  }
}

/** The area both polygons share, or null when the operation fails. */
export function intersection(a: Polygon, b: Polygon, minArea = 0.05): Polygon[] | null {
  try {
    return fromClip(clipIntersection(toClip(a), toClip(b)) as ClipPolygon[], minArea);
  } catch {
    return null;
  }
}

/** Union of polygons, or null when the operation fails. */
export function union(polygons: readonly Polygon[], minArea = 0.05): Polygon[] | null {
  if (polygons.length === 0) return [];
  try {
    const [first, ...rest] = polygons.map(toClip);
    return fromClip(clipUnion(first as ClipPolygon, ...rest) as ClipPolygon[], minArea);
  } catch {
    return null;
  }
}
