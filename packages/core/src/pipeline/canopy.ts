import { shade } from '../colour';
import { offsetRing } from '../geom/polygon';
import { type Vec2, cross, distance, normalize, sub } from '../geom/vec2';
import type { MeshBuilder } from '../mesh/builder';
import { getStylePack } from '../styles/registry';
import { type CanopyStyle, evalCurve } from '../styles/types';
import type { ResolvedSpec, RoofGeometry, Vec3, Vec3In, WallContext, WallSegment } from '../types';

const DEFAULT: CanopyStyle = { post: 0.25, spacing: 5, fascia: 0.3 };
/** Corners that turn less than this (sine of the angle) get no post of their own. */
const CORNER_TURN = 0.4;
/** Beam under the eave of pitched canopy roofs. */
const BEAM = 0.22;

export interface CanopyStage {
  mb: MeshBuilder;
  spec: ResolvedSpec;
  walls: WallSegment[];
  context: WallContext[];
  roof: RoofGeometry;
  baseElevation: number;
}

/** True when a neighbour stands at `along` metres on the wall (the canopy is fixed to it there). */
function attachedAt(ctx: WallContext | undefined, along: number, margin: number): boolean {
  if (!ctx) return false;
  return ctx.blocked.some(
    (s) => s.from - margin <= along && s.to + margin >= along && (s.minHeight ?? 0) < 2,
  );
}

/**
 * The structure of a roof on posts (type `canopy`): posts at the corners and along
 * the edges, and under the roof either a slab with a fascia (flat roofs) or a beam
 * ring (pitched roofs, whose gables stay open). Edges along a neighbouring building
 * get no posts: the canopy is fixed to that wall. The roof faces themselves are
 * drawn by the roof stage like on any building.
 */
export function addCanopy(stage: CanopyStage): void {
  const { mb, spec, walls, context, roof, baseElevation } = stage;
  const style = getStylePack(spec.packId).types[spec.type].canopy ?? DEFAULT;
  const { era, palette } = spec;
  const ground = baseElevation;
  const eave = baseElevation + spec.base + spec.wallHeight;
  const at = (p: Vec2, h: number): Vec3 => [p[0], h, -p[1]];
  const flat = spec.roof.shape === 'flat';
  // With min_height mapped, the structure fills the band between min_height and the eave.
  const depth = spec.base > 0.5 ? Math.max(0.2, spec.wallHeight) : flat ? evalCurve(style.fascia, era) : BEAM;
  const under = Math.max(ground + 1.8, eave - depth);
  const fascia = flat ? palette.trim : shade(palette.roof, 0.78);
  const outer = spec.footprint.outer;
  const rings = [outer, ...spec.footprint.holes];

  if (flat) {
    // Slab: the fascia band from `under` to the eave along every edge, and a soffit.
    for (const ring of rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const a = ring[i] as Vec2;
        const b = ring[(i + 1) % n] as Vec2;
        mb.quad(at(a, under), at(b, under), at(b, eave), at(a, eave), fascia);
      }
    }
    mb.polygon(
      [...outer].reverse().map((p) => at(p, under)),
      shade(palette.trim, 0.72),
      spec.footprint.holes.map((h) => [...h].reverse().map((p) => at(p, under))),
    );
  } else {
    // Undersides of the roof faces, unless the eave slab of the roof stage already drew them.
    const drawn = roof.outline.length >= 3 && spec.roof.overhang > 0;
    if (!drawn)
      for (const face of roof.faces) {
        const pts = face.points
          .map((p: Vec3In): Vec3 => [p[0], baseElevation + p[2] - 0.06, -p[1]])
          .reverse();
        mb.polygon(pts, shade(palette.roof, 0.6));
      }
    // Beams along every edge, following the roof line (rafters along gable ends and lean-to sides).
    const n = outer.length;
    const inner = offsetRing(outer, -0.15);
    for (let i = 0; i < n; i++) {
      const wall = walls[i];
      if (!wall) continue;
      const a = outer[i] as Vec2;
      const b = outer[(i + 1) % n] as Vec2;
      const ia = inner[i] as Vec2;
      const ib = inner[(i + 1) % n] as Vec2;
      const profile =
        wall.top.length >= 2
          ? wall.top
          : [
              { t: 0, h: 0 },
              { t: 1, h: 0 },
            ];
      const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [
        p[0] + (q[0] - p[0]) * t,
        p[1] + (q[1] - p[1]) * t,
      ];
      for (let k = 0; k + 1 < profile.length; k++) {
        const p0 = profile[k] as { t: number; h: number };
        const p1 = profile[k + 1] as { t: number; h: number };
        const o0 = lerp(a, b, p0.t);
        const o1 = lerp(a, b, p1.t);
        const i0 = lerp(ia, ib, p0.t);
        const i1 = lerp(ia, ib, p1.t);
        const top0 = eave + p0.h;
        const top1 = eave + p1.h;
        mb.quad(at(o0, top0 - depth), at(o1, top1 - depth), at(o1, top1), at(o0, top0), fascia);
        mb.quad(at(i1, top1 - depth), at(i0, top0 - depth), at(i0, top0), at(i1, top1), fascia);
        mb.quad(
          at(o0, top0 - depth),
          at(i0, top0 - depth),
          at(i1, top1 - depth),
          at(o1, top1 - depth),
          shade(fascia, 0.8),
        );
      }
    }
  }

  // --- Posts ---
  const post = evalCurve(style.post, era);
  const spacing = Math.max(2, evalCurve(style.spacing, era));
  const inset = post / 2 + 0.12;
  const line = offsetRing(outer, -inset);
  const n = outer.length;
  const placed: Vec2[] = [];
  const put = (p: Vec2, dir: Vec2): void => {
    if (placed.some((q) => distance(p, q) < spacing * 0.4)) return;
    placed.push(p);
    // Under a pitched roof the post runs up to the beam, which follows the roof line.
    const top = flat ? under : Math.max(under, eave + Math.max(0, roof.heightAt(p)) - depth);
    const h = post / 2;
    const s: Vec2 = [-dir[1], dir[0]];
    const c: Vec2[] = [
      [p[0] - dir[0] * h - s[0] * h, p[1] - dir[1] * h - s[1] * h],
      [p[0] + dir[0] * h - s[0] * h, p[1] + dir[1] * h - s[1] * h],
      [p[0] + dir[0] * h + s[0] * h, p[1] + dir[1] * h + s[1] * h],
      [p[0] - dir[0] * h + s[0] * h, p[1] - dir[1] * h + s[1] * h],
    ];
    for (let k = 0; k < 4; k++) {
      const a = c[k] as Vec2;
      const b = c[(k + 1) % 4] as Vec2;
      mb.quad(at(a, ground), at(b, ground), at(b, top), at(a, top), palette.wall);
    }
  };
  for (let i = 0; i < n; i++) {
    // The outer ring's walls come first, in ring order.
    const wall = walls[i];
    const prev = walls[(i + n - 1) % n];
    if (!wall || !prev) continue;
    const ctx = context[i];
    const prevCtx = context[(i + n - 1) % n];
    const a = line[i] as Vec2;
    const b = line[(i + 1) % n] as Vec2;
    const dir = normalize(sub(b, a));
    const turn = Math.abs(cross(prev.dir, wall.dir));
    // Corner post, unless the corner is fixed to a neighbour or barely turns.
    if (turn > CORNER_TURN && !attachedAt(ctx, 0, 0.5) && !attachedAt(prevCtx, prev.length, 0.5)) put(a, dir);
    const length = distance(a, b);
    const count = Math.ceil(length / spacing - 1e-6);
    for (let k = 1; k < count; k++) {
      const t = k / count;
      if (attachedAt(ctx, wall.length * t, 0.3)) continue;
      put([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir);
    }
  }
}
