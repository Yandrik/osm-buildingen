import { clipRing, offsetRing } from '../../geom/polygon';
import { type Vec2, cross, dot, perp, sub } from '../../geom/vec2';
import type { RoofGeometry, Vec3In, WallSegment } from '../../types';
import type { RoofContext } from './index';

/**
 * Gabled roof with the ridge through the centre of the oriented box.
 * Height falls off linearly with the distance from the ridge line, so the result
 * is exact for rectangles and a reasonable "one big gable" for other outlines.
 */
export function buildGabled(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave, overhang } = ctx;
  const outer = spec.footprint.outer;
  const axis = spec.roof.ridgeAxis;
  const side = perp(axis);
  const center = spec.metrics.box.center;

  let halfSpan = 0;
  for (const p of outer) halfSpan = Math.max(halfSpan, Math.abs(dot(sub(p, center), side)));
  if (halfSpan < 0.3 || spec.roof.height <= 0) return null;

  const heightAt = (p: Vec2): number =>
    spec.roof.height * (1 - Math.abs(dot(sub(p, center), side)) / halfSpan);
  const lift = (p: Vec2): Vec3In => [p[0], p[1], eave + heightAt(p)];

  const outline2d = overhang.some((o) => o > 0) ? offsetRing(outer, overhang) : outer;
  const left = clipRing(outline2d, center, side);
  const right = clipRing(outline2d, center, [-side[0], -side[1]]);
  if (left.length < 3 || right.length < 3) return null;

  // Roof edge with the ridge ends inserted, so the rake has its peak.
  const outline: Vec3In[] = [];
  const n = outline2d.length;
  for (let i = 0; i < n; i++) {
    const a = outline2d[i] as Vec2;
    const b = outline2d[(i + 1) % n] as Vec2;
    outline.push(lift(a));
    const da = dot(sub(a, center), side);
    const db = dot(sub(b, center), side);
    if (da * db < -1e-9) {
      const t = da / (da - db);
      outline.push(lift([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    }
  }

  return {
    faces: [
      { points: left.map(lift), kind: 'slope' },
      { points: right.map(lift), kind: 'slope' },
    ],
    outline,
    heightAt,
    breaks(wall: WallSegment): number[] {
      // Where the wall crosses the ridge line.
      const den = cross(wall.dir, axis);
      if (Math.abs(den) < 1e-9) return [];
      const t = cross(sub(center, wall.a), axis) / den / wall.length;
      return t > 0 && t < 1 ? [t] : [];
    },
  };
}
