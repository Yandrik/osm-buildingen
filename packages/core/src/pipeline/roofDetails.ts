import { type Colour, shade } from '../colour';
import { centroid, pointInRing } from '../geom/polygon';
import { type Vec2, dot, normalize, pointSegment, sub } from '../geom/vec2';
import type { MeshBuilder } from '../mesh/builder';
import type { Frame } from '../mesh/frame';
import { box, rect } from '../mesh/frame';
import { PIECES, type PieceContext } from '../pieces';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { evalCurve } from '../styles/types';
import type { ResolvedSpec, RoofFace, RoofGeometry, Vec3, Vec3In, WallContext, WallSegment } from '../types';
import { GENERATOR_VERSION } from '../version';

export interface RoofDetailStage {
  mb: MeshBuilder;
  spec: ResolvedSpec;
  walls: WallSegment[];
  context: WallContext[];
  roof: RoofGeometry;
  baseElevation: number;
  seed: string | number;
}

interface Plane {
  /** z = z0 + gx * x + gy * y */
  z0: number;
  gx: number;
  gy: number;
}

function planeOf(face: RoofFace): Plane | null {
  // Newell normal in (east, north, up).
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = face.points.length;
  for (let i = 0; i < n; i++) {
    const p = face.points[i] as Vec3In;
    const q = face.points[(i + 1) % n] as Vec3In;
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  if (Math.abs(nz) < 1e-9) return null;
  const p0 = face.points[0] as Vec3In;
  const gx = -nx / nz;
  const gy = -ny / nz;
  return { z0: p0[2] - gx * p0[0] - gy * p0[1], gx, gy };
}

const planArea = (face: RoofFace): number => {
  let a = 0;
  const n = face.points.length;
  for (let i = 0; i < n; i++) {
    const p = face.points[i] as Vec3In;
    const q = face.points[(i + 1) % n] as Vec3In;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

/**
 * Stage 5. Chimneys, dormers, attic windows and flat-roof clutter.
 * Everything here is optional decoration: when something does not fit, it is left out.
 * See plan/pipeline/05-roof-details.md.
 */
export function addRoofDetails(stage: RoofDetailStage): number {
  const { mb, spec, walls, context, roof, baseElevation } = stage;
  const style = getStylePack(spec.packId).types[spec.type].roofDetails;
  if (!style) return 0;
  const rng = new Rng(seedFrom(GENERATOR_VERSION, 'roofDetails', stage.seed));
  const world = (p: Vec2, z: number): Vec3 => [p[0], baseElevation + z, -p[1]];
  const eave = spec.base + spec.wallHeight;
  const { palette, era } = spec;
  let count = 0;

  /** Upright box on four plan corners (counter-clockwise), from z0 to z1, with a lid. */
  const prism = (c: readonly Vec2[], z0: number, z1: number, side: Colour, lid: Colour): void => {
    for (let i = 0; i < c.length; i++) {
      const a = c[i] as Vec2;
      const b = c[(i + 1) % c.length] as Vec2;
      mb.quad(world(a, z0), world(b, z0), world(b, z1), world(a, z1), side);
    }
    mb.polygon(
      c.map((p) => world(p, z1)),
      lid,
    );
  };
  const boxAt = (centre: Vec2, axis: Vec2, halfL: number, halfW: number): Vec2[] => {
    const s: Vec2 = [-axis[1], axis[0]];
    return [
      [centre[0] - axis[0] * halfL - s[0] * halfW, centre[1] - axis[1] * halfL - s[1] * halfW],
      [centre[0] + axis[0] * halfL - s[0] * halfW, centre[1] + axis[1] * halfL - s[1] * halfW],
      [centre[0] + axis[0] * halfL + s[0] * halfW, centre[1] + axis[1] * halfL + s[1] * halfW],
      [centre[0] - axis[0] * halfL + s[0] * halfW, centre[1] - axis[1] * halfL + s[1] * halfW],
    ];
  };

  const slopes = roof.faces.filter((f) => f.kind === 'slope');
  // Curved roofs (domes, barrels) have no 'slope' faces, so they get no chimneys or dormers.
  const pitched = spec.roof.shape !== 'flat' && slopes.length > 0;

  // --- Chimneys ---
  if (pitched && spec.roof.height > 1.2) {
    const chimneys = rng.fork('chimney').chance(evalCurve(style.chimney ?? 0, era))
      ? spec.metrics.area > 160
        ? 2
        : 1
      : 0;
    const bySize = [...slopes].sort((a, b) => planArea(b) - planArea(a));
    for (let i = 0; i < chimneys && i < bySize.length; i++) {
      const face = bySize[i] as RoofFace;
      const plane = planeOf(face);
      if (!plane) continue;
      const ring: Vec2[] = face.points.map((p) => [p[0], p[1]]);
      const c = centroid(ring);
      let high = face.points[0] as Vec3In;
      for (const p of face.points) if (p[2] > high[2]) high = p;
      const t = 0.4 + rng.next() * 0.2;
      const along = (rng.next() - 0.5) * Math.min(4, spec.metrics.box.halfLength);
      const at: Vec2 = [
        c[0] + (high[0] - c[0]) * t + spec.roof.ridgeAxis[0] * along,
        c[1] + (high[1] - c[1]) * t + spec.roof.ridgeAxis[1] * along,
      ];
      if (!pointInRing(at, ring)) continue;
      const half = spec.metrics.area > 250 ? 0.4 : 0.28;
      const zRoof = plane.z0 + plane.gx * at[0] + plane.gy * at[1];
      const top = Math.max(zRoof + 0.9, eave + spec.roof.height + 0.35);
      const body = era < 0.45 ? 0x9a5a48 : shade(palette.wall, 0.9);
      prism(boxAt(at, spec.roof.ridgeAxis, half, half), zRoof - 0.4, top, body, shade(body, 0.55));
      count++;
    }
  }

  // --- Dormers ---
  if (pitched && spec.roof.height >= 2.4 && rng.fork('dormers').chance(evalCurve(style.dormer ?? 0, era))) {
    const piece = PIECES.window;
    for (const face of slopes) {
      const plane = planeOf(face);
      if (!plane || !piece) continue;
      const slope = Math.hypot(plane.gx, plane.gy);
      if (slope < 0.45 || slope > 1.6) continue;
      // Eave edge: the lowest, level, long edge of the face.
      let best = -1;
      let bestZ = Number.POSITIVE_INFINITY;
      const n = face.points.length;
      for (let i = 0; i < n; i++) {
        const p = face.points[i] as Vec3In;
        const q = face.points[(i + 1) % n] as Vec3In;
        if (Math.abs(p[2] - q[2]) > 0.05 || Math.hypot(q[0] - p[0], q[1] - p[1]) < 4.5) continue;
        if (p[2] < bestZ - 1e-6) {
          bestZ = p[2];
          best = i;
        }
      }
      if (best < 0) continue;
      const a = face.points[best] as Vec3In;
      const b = face.points[(best + 1) % n] as Vec3In;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const e: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const up = normalize([plane.gx, plane.gy]); // direction in which the roof rises
      if (Math.abs(dot(up, e)) > 0.1) continue;
      // Skip faces above blocked walls.
      const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const below = walls.findIndex(
        (w) =>
          w.ring === 0 &&
          pointSegment(mid, w.a, w.b).distance < spec.roof.overhang + 0.4 &&
          Math.abs(dot(w.dir, e)) > 0.95,
      );
      if (below < 0 || (context[below] as WallContext).openFraction < 0.6) continue;

      const ring: Vec2[] = face.points.map((p) => [p[0], p[1]]);
      const wallRun = Math.max(0, (eave - a[2]) / slope); // overhang, measured on plan
      const hd = 1.25;
      const wd = 1.3;
      const r0 = wallRun + 0.55;
      const r1 = r0 + hd / slope;
      const slots = Math.floor((length - 2 * wallRun - 1.4) / 3.1);
      if (slots < 1) continue;
      const wanted = Math.max(1, Math.min(slots, 1 + rng.int(Math.min(slots, 3))));
      const span = length - 2 * wallRun;
      for (let k = 0; k < wanted; k++) {
        const u = wallRun + (span * (k + 1)) / (wanted + 1);
        const P = (du: number, r: number): Vec2 => [
          a[0] + e[0] * (u + du) + up[0] * r,
          a[1] + e[1] * (u + du) + up[1] * r,
        ];
        const corners = [P(-wd / 2, r0), P(wd / 2, r0), P(wd / 2, r1 + 0.2), P(-wd / 2, r1 + 0.2)];
        if (!corners.every((c) => pointInRing(c, ring))) continue;
        const z0 = a[2] + slope * r0;
        const z1 = z0 + hd;
        // Front with a window. The viewer stands outside looking up the slope, so when `up`
        // is to the left of `e` (the usual case) the viewer's left is at the start of `e`.
        const leftSign = e[0] * up[1] - e[1] * up[0] > 0 ? -1 : 1;
        const fl = P((leftSign * wd) / 2, r0);
        const fr = P((-leftSign * wd) / 2, r0);
        const d = normalize(sub(fr, fl));
        const frame: Frame = {
          origin: world(fl, z0),
          right: [d[0], 0, -d[1]],
          up: [0, 1, 0],
          normal: [-up[0], 0, up[1]],
          width: wd,
          height: hd,
        };
        const ctx: PieceContext = {
          params: { w: 0.72, h: 0.66, sill: 0.14, mullionV: 1 },
          palette,
          wall: palette.wall,
          plinth: 0,
          timber: false,
          era,
          seed: 0,
        };
        piece(mb, frame, ctx);
        // Cheeks: triangles from the front edge back to where the dormer roof meets the main roof.
        const bl = P((leftSign * wd) / 2, r1);
        const br = P((-leftSign * wd) / 2, r1);
        mb.tri(world(bl, z1), world(fl, z0), world(fl, z1), palette.wall);
        mb.tri(world(fr, z0), world(br, z1), world(fr, z1), palette.wall);
        // Lid with a small overhang at the front and sides.
        const o = 0.12;
        const lid = [
          P((leftSign * (wd + 2 * o)) / 2, r0 - o),
          P((-leftSign * (wd + 2 * o)) / 2, r0 - o),
          br,
          bl,
        ];
        mb.quad(
          world(lid[0] as Vec2, z1),
          world(lid[1] as Vec2, z1),
          world(lid[2] as Vec2, z1 + 0.02),
          world(lid[3] as Vec2, z1 + 0.02),
          palette.roof,
        );
        mb.quad(
          world(lid[1] as Vec2, z1),
          world(lid[0] as Vec2, z1),
          world(lid[0] as Vec2, z1 - 0.1),
          world(lid[1] as Vec2, z1 - 0.1),
          shade(palette.roof, 0.78),
        );
        count++;
      }
    }
  }

  // --- Attic windows in gable walls ---
  if (pitched && style.atticWindow !== undefined) {
    const p = evalCurve(style.atticWindow, era);
    walls.forEach((wall, w) => {
      if (wall.top.length < 3 || wall.length < 4.5 || (context[w] as WallContext).openFraction < 0.7) return;
      let peak = wall.top[0] as { t: number; h: number };
      for (const q of wall.top) if (q.h > peak.h) peak = q;
      if (peak.h < 2.3 || peak.t < 0.3 || peak.t > 0.7) return;
      if (!rng.fork('attic', w).chance(p)) return;
      const ww = Math.min(1.1, wall.length * 0.16);
      const wh = Math.min(1.2, peak.h * 0.38);
      const v0 = peak.h * 0.2;
      // Half-width of the gable at the top of the window must leave some wall beside it.
      const halfAtTop = wall.length * Math.min(peak.t, 1 - peak.t) * (1 - (v0 + wh) / peak.h);
      if (halfAtTop < ww / 2 + 0.25) return;
      const x = wall.length * peak.t - ww / 2;
      const origin: Vec2 = [wall.a[0] + wall.dir[0] * x, wall.a[1] + wall.dir[1] * x];
      const frame: Frame = {
        origin: world(origin, eave + v0),
        right: [wall.dir[0], 0, -wall.dir[1]],
        up: [0, 1, 0],
        normal: [wall.normal[0], 0, -wall.normal[1]],
        width: ww,
        height: wh,
      };
      const side = shade(palette.frame, 0.85);
      box(mb, frame, 0, 0, ww, wh, 0, 0.04, palette.frame, {}, side);
      rect(mb, frame, 0.08, 0.08, ww - 0.08, wh - 0.08, palette.glass, 0.045);
      box(mb, frame, ww / 2 - 0.025, 0.08, ww / 2 + 0.025, wh - 0.08, 0.045, 0.06, palette.frame, {
        top: false,
        bottom: false,
      });
      count++;
    });
  }

  // --- Flat roofs: units and a stair head ---
  if (spec.roof.shape === 'flat' && rng.fork('clutter').chance(evalCurve(style.clutter ?? 0, era))) {
    const outer = spec.footprint.outer;
    const rings = [outer, ...spec.footprint.holes];
    const { box: obb } = spec.metrics;
    const edgeDistance = (p: Vec2): number => {
      let dmin = Number.POSITIVE_INFINITY;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const dd = pointSegment(p, ring[i] as Vec2, ring[(i + 1) % ring.length] as Vec2).distance;
          if (dd < dmin) dmin = dd;
        }
      }
      return dmin;
    };
    const inside = (p: Vec2): boolean =>
      pointInRing(p, outer) && !spec.footprint.holes.some((h) => pointInRing(p, h));
    const placed: { p: Vec2; r: number }[] = [];
    const tryPlace = (halfL: number, halfW: number, height: number, side: Colour, lid: Colour): void => {
      const r = Math.hypot(halfL, halfW);
      for (let attempt = 0; attempt < 12; attempt++) {
        const u = (rng.next() * 2 - 1) * obb.halfLength;
        const v = (rng.next() * 2 - 1) * obb.halfWidth;
        const p: Vec2 = [
          obb.center[0] + obb.axis[0] * u + obb.side[0] * v,
          obb.center[1] + obb.axis[1] * u + obb.side[1] * v,
        ];
        if (!inside(p) || edgeDistance(p) < r + 0.8) continue;
        if (placed.some((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < q.r + r + 0.6)) continue;
        placed.push({ p, r });
        prism(boxAt(p, obb.axis, halfL, halfW), eave, eave + height, side, lid);
        count++;
        return;
      }
    };
    if (spec.levelHeights.length >= 3 && spec.metrics.area > 150) {
      tryPlace(1.6, 1.3, 2.3, shade(palette.wall, 0.95), palette.trim);
    }
    const units = 1 + rng.int(Math.min(4, 1 + Math.floor(spec.metrics.area / 250)));
    for (let i = 0; i < units; i++) {
      tryPlace(0.6 + rng.next() * 0.7, 0.5 + rng.next() * 0.4, 0.6 + rng.next() * 0.5, 0xb4b8bc, 0x8a8e92);
    }
  }

  return count;
}
