import { centroid } from '../../geom/polygon';
import { type Vec2, cross, sub } from '../../geom/vec2';
import type { RoofFace, RoofGeometry, RoofProfile, Vec3In } from '../../types';
import { type RoofContext, noBreaks, zeroHeight } from './index';

/**
 * A point from which every edge of the ring is seen from its inside, so the ring
 * can be shrunk towards it without folding over. Tries the centre of the oriented
 * box first (symmetric results on regular shapes), then the centroid.
 */
export function radialCentre(outer: readonly Vec2[], boxCentre: Vec2): Vec2 | null {
  const sees = (c: Vec2): boolean => {
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      if (cross(sub(outer[i] as Vec2, c), sub(outer[(i + 1) % n] as Vec2, c)) <= 1e-6) return false;
    }
    return true;
  };
  if (sees(boxCentre)) return boxCentre;
  const c = centroid(outer);
  return sees(c) ? c : null;
}

/** Profile of a radial roof: (scale of the footprint, share of the roof height), bottom to top. */
type Profile = RoofProfile;

const DOME: Profile = [0, 1, 2, 3, 4, 5].map((k) => {
  const a = (k / 5) * (Math.PI / 2);
  // Rounded to keep the profile identical on every engine.
  return [Math.round(Math.cos(a) * 1000) / 1000, Math.round(Math.sin(a) * 1000) / 1000] as const;
});

/** Bulges out past the wall, then tapers to a point. */
const ONION: Profile = [
  [1, 0],
  [1.16, 0.1],
  [1.22, 0.22],
  [1.12, 0.38],
  [0.82, 0.54],
  [0.48, 0.68],
  [0.22, 0.8],
  [0.08, 0.9],
  [0, 1],
];

const CONE: Profile = [
  [1, 0],
  [0, 1],
];

/**
 * Roofs made by shrinking the footprint towards a centre while rising:
 * cone, dome and onion, or any outline given as `roof.profile` (a lathe: bell
 * roofs, lanterns, stacked bulbs). Works on any footprint that has such a centre
 * (round towers, apses, regular polygons, rectangles); returns null otherwise.
 */
export function buildRadial(ctx: RoofContext, shape: 'cone' | 'dome' | 'onion'): RoofGeometry | null {
  const { spec, eave } = ctx;
  const outer = spec.footprint.outer;
  if (spec.roof.height <= 0) return null;
  const c = radialCentre(outer, spec.metrics.box.center);
  if (!c) return null;
  const profile = spec.roof.profile ?? (shape === 'dome' ? DOME : shape === 'onion' ? ONION : CONE);
  const ring = (scale: number, share: number): Vec3In[] =>
    outer.map((p) => [
      c[0] + (p[0] - c[0]) * scale,
      c[1] + (p[1] - c[1]) * scale,
      eave + spec.roof.height * share,
    ]);

  const faces: RoofFace[] = [];
  const n = outer.length;
  let lower = ring(profile[0]?.[0] ?? 1, profile[0]?.[1] ?? 0);
  for (let k = 1; k < profile.length; k++) {
    const [scale, share] = profile[k] as readonly [number, number];
    const upper = ring(scale, share);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = lower[i] as Vec3In;
      const b = lower[j] as Vec3In;
      // The last ring is a single point: triangles instead of quads.
      faces.push({
        points: scale === 0 ? [a, b, upper[i] as Vec3In] : [a, b, upper[j] as Vec3In, upper[i] as Vec3In],
        kind: 'curved',
      });
    }
    lower = upper;
  }
  // A profile that ends with some width left gets a lid.
  if (((profile[profile.length - 1] as readonly [number, number])[0] ?? 0) > 0)
    faces.push({ points: lower, kind: 'curved' });
  return { faces, outline: [], heightAt: zeroHeight, breaks: noBreaks };
}
