import { type Vec2, distance, normalize, sub } from '../geom/vec2';
import type { ResolvedSpec, RoofGeometry, WallSegment } from '../types';

/** One wall per footprint edge. Outer ring first, then holes. */
export function buildWalls(spec: ResolvedSpec): WallSegment[] {
  const walls: WallSegment[] = [];
  const rings = [spec.footprint.outer, ...spec.footprint.holes];
  rings.forEach((ring, ringIndex) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % n] as Vec2;
      const dir = normalize(sub(b, a));
      walls.push({
        a,
        b,
        length: distance(a, b),
        dir,
        // Outer ring is counter-clockwise and holes clockwise, so the outside is always on the right.
        normal: [dir[1], -dir[0]],
        ring: ringIndex,
        index: i,
        top: [],
      });
    }
  });
  return walls;
}

/** Fills in each wall's top profile (the part above the eave line) from the roof. */
export function applyRoofToWalls(walls: WallSegment[], roof: RoofGeometry): void {
  for (const wall of walls) {
    const ts = [0, ...roof.breaks(wall).filter((t) => t > 1e-4 && t < 1 - 1e-4), 1].sort((x, y) => x - y);
    const top = ts.map((t) => ({
      t,
      h: Math.max(
        0,
        roof.heightAt([wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t]),
      ),
    }));
    wall.top = top.some((p) => p.h > 1e-3) ? top : [];
  }
}
