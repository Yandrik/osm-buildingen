import { type Colour, shade } from '../colour';
import { centroid, distanceToRing, pointInRing } from '../geom/polygon';
import { type Vec2, dot, normalize, pointSegment, sub } from '../geom/vec2';
import type { MeshBuilder } from '../mesh/builder';
import type { Frame } from '../mesh/frame';
import { box, rect } from '../mesh/frame';
import { PIECES, type PieceContext } from '../pieces';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { evalCurve } from '../styles/types';
import type {
  Polygon,
  ResolvedSpec,
  RoofFace,
  RoofGeometry,
  Vec3,
  Vec3In,
  WallContext,
  WallSegment,
} from '../types';
import { GENERATOR_VERSION } from '../version';

export interface RoofDetailStage {
  mb: MeshBuilder;
  spec: ResolvedSpec;
  walls: WallSegment[];
  context: WallContext[];
  roof: RoofGeometry;
  baseElevation: number;
  seed: string | number;
  /** Footprints of parts standing on this roof. */
  onRoof?: readonly Polygon[];
  /** Wall with the entrance, or -1. */
  streetWall?: number;
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

  /** Roof surface height at a plan point (on the face above it), or null outside the roof. */
  const roofZ = (p: Vec2): number | null => {
    for (const face of roof.faces) {
      if (
        !pointInRing(
          p,
          face.points.map((q): Vec2 => [q[0], q[1]]),
        )
      )
        continue;
      const plane = planeOf(face);
      if (plane) return plane.z0 + plane.gx * p[0] + plane.gy * p[1];
    }
    return null;
  };

  // --- Clock turret on the ridge (old stations) ---
  if (
    pitched &&
    style.turret !== undefined &&
    spec.roof.height > 1.5 &&
    spec.metrics.area > 100 &&
    rng.fork('turret').chance(evalCurve(style.turret, era))
  ) {
    const { box: obb } = spec.metrics;
    const half = Math.min(1.3, Math.max(0.8, obb.halfWidth * 0.22));
    const corners = boxAt(obb.center, obb.axis, half, half);
    const lows = corners.map(roofZ);
    if (lows.every((z) => z !== null)) {
      const z0 = Math.min(...(lows as number[])) - 0.1;
      const ridge = eave + spec.roof.height;
      const body = palette.trim;
      const zc = ridge + 1.0;
      const top = zc + 0.85;
      prism(corners, z0, top, shade(body, 0.95), body);
      // A clock on every side: a white disc with two dark hands.
      for (let k = 0; k < 4; k++) {
        const a = corners[k] as Vec2;
        const b = corners[(k + 1) % 4] as Vec2;
        const t = normalize(sub(b, a));
        const n: Vec2 = [t[1], -t[0]];
        const c: Vec2 = [(a[0] + b[0]) / 2 + n[0] * 0.03, (a[1] + b[1]) / 2 + n[1] * 0.03];
        const r = half * 0.62;
        const disc: Vec3[] = [];
        for (let j = 0; j < 8; j++) {
          const th = ((j + 0.5) / 8) * 2 * Math.PI;
          const u = Math.cos(th) * r;
          disc.push(world([c[0] + t[0] * u, c[1] + t[1] * u], zc + Math.sin(th) * r));
        }
        mb.polygon(disc, 0xf4f1e8);
        const h: Vec2 = [c[0] + n[0] * 0.02, c[1] + n[1] * 0.02];
        const p = (u: number): Vec2 => [h[0] + t[0] * u, h[1] + t[1] * u];
        mb.quad(
          world(p(-0.03), zc),
          world(p(0.03), zc),
          world(p(0.03), zc + r * 0.75),
          world(p(-0.03), zc + r * 0.75),
          0x2a2a2a,
        );
        mb.quad(
          world(p(0), zc - 0.03),
          world(p(r * 0.55), zc - 0.03),
          world(p(r * 0.55), zc + 0.03),
          world(p(0), zc + 0.03),
          0x2a2a2a,
        );
      }
      // Pyramid cap with a small overhang.
      const capCorners = boxAt(obb.center, obb.axis, half + 0.15, half + 0.15);
      const apex = world(obb.center, top + half * 1.6);
      const capColour = era < 0.3 ? 0x5f8a78 : palette.roof;
      for (let k = 0; k < 4; k++) {
        mb.tri(
          world(capCorners[k] as Vec2, top),
          world(capCorners[(k + 1) % 4] as Vec2, top),
          apex,
          capColour,
        );
      }
      mb.polygon(
        [...capCorners].reverse().map((q) => world(q, top)),
        shade(capColour, 0.6),
      );
      count++;
    }
  }

  const { box: obb } = spec.metrics;
  /** Plan point at (u, v) in the oriented box frame. */
  const inBox = (u: number, v: number): Vec2 => [
    obb.center[0] + obb.axis[0] * u + obb.side[0] * v,
    obb.center[1] + obb.axis[1] * u + obb.side[1] * v,
  ];
  /** Plan rings of details placed so far that later clutter must keep clear of. */
  const taken: Vec2[][] = [];
  const free = (p: Vec2): boolean =>
    pointInRing(p, spec.footprint.outer) &&
    !spec.footprint.holes.some((h) => pointInRing(p, h)) &&
    !(stage.onRoof ?? []).some((poly) => pointInRing(p, poly.outer));

  // --- Halls: rows of glazed strips on flat roofs ---
  if (
    spec.roof.shape === 'flat' &&
    spec.metrics.rectangularity > 0.8 &&
    obb.halfWidth > 5 &&
    rng.fork('skylights').chance(evalCurve(style.skylights ?? 0, era))
  ) {
    const rows = Math.max(1, Math.floor((2 * obb.halfWidth - 4) / 7));
    const half = obb.halfLength - 2.5;
    const strip = 0.8;
    for (let k = 0; k < rows && half > 2; k++) {
      const v = -obb.halfWidth + (2 * obb.halfWidth * (k + 0.5)) / rows;
      const c = boxAt(inBox(0, v), obb.axis, half, strip);
      if (!c.every(free)) continue;
      prism(c, eave, eave + 0.35, shade(palette.wall, 0.85), shade(palette.wall, 0.85));
      taken.push(c);
      // Glazed ridge on top: two slopes.
      const lo0 = inBox(-half, v - strip);
      const lo1 = inBox(half, v - strip);
      const hi0 = inBox(-half, v);
      const hi1 = inBox(half, v);
      const lo2 = inBox(half, v + strip);
      const lo3 = inBox(-half, v + strip);
      const z = eave + 0.35;
      mb.quad(world(lo0, z), world(lo1, z), world(hi1, z + 0.45), world(hi0, z + 0.45), palette.glass);
      mb.quad(world(lo2, z), world(lo3, z), world(hi0, z + 0.45), world(hi1, z + 0.45), palette.glass);
      mb.tri(world(lo1, z), world(lo2, z), world(hi1, z + 0.45), shade(palette.wall, 0.85));
      mb.tri(world(lo3, z), world(lo0, z), world(hi0, z + 0.45), shade(palette.wall, 0.85));
      count++;
    }
  }

  // --- Halls: a raised vent along the ridge of a gabled roof ---
  if (
    spec.roof.shape === 'gabled' &&
    spec.metrics.rectangularity > 0.85 &&
    obb.halfLength > 8 &&
    rng.fork('ridgeVent').chance(evalCurve(style.ridgeVent ?? 0, era))
  ) {
    const axis = spec.roof.ridgeAxis;
    const along = Math.abs(dot(axis, obb.axis)) > 0.7;
    const halfL = (along ? obb.halfLength : obb.halfWidth) * 0.7;
    const ridge = eave + spec.roof.height;
    const w = 0.7;
    const c = boxAt(obb.center, axis, halfL, w);
    const zs = c.map(roofZ);
    if (zs.every((z) => z !== null)) {
      const z0 = Math.min(...(zs as number[])) - 0.05;
      prism(c, z0, ridge + 0.55, 0x3d4145, 0x3d4145);
      // Its own small gabled cap.
      const s: Vec2 = [-axis[1], axis[0]];
      const o = 0.25;
      const e0: Vec2 = [obb.center[0] - axis[0] * (halfL + o), obb.center[1] - axis[1] * (halfL + o)];
      const e1: Vec2 = [obb.center[0] + axis[0] * (halfL + o), obb.center[1] + axis[1] * (halfL + o)];
      const off = (p: Vec2, d: number): Vec2 => [p[0] + s[0] * d, p[1] + s[1] * d];
      const zt = ridge + 0.55;
      mb.quad(
        world(off(e0, -(w + o)), zt - 0.1),
        world(off(e1, -(w + o)), zt - 0.1),
        world(e1, zt + 0.35),
        world(e0, zt + 0.35),
        palette.roof,
      );
      mb.quad(
        world(off(e1, w + o), zt - 0.1),
        world(off(e0, w + o), zt - 0.1),
        world(e0, zt + 0.35),
        world(e1, zt + 0.35),
        palette.roof,
      );
      mb.tri(
        world(off(e1, -(w + o)), zt - 0.1),
        world(off(e1, w + o), zt - 0.1),
        world(e1, zt + 0.35),
        shade(palette.roof, 0.8),
      );
      mb.tri(
        world(off(e0, w + o), zt - 0.1),
        world(off(e0, -(w + o)), zt - 0.1),
        world(e0, zt + 0.35),
        shade(palette.roof, 0.8),
      );
      count++;
    }
  }

  // --- Old factories: one tall chimney stack near a corner of the roof ---
  if (obb.halfWidth > 4 && rng.fork('stack').chance(evalCurve(style.chimneyStack ?? 0, era))) {
    const srng = rng.fork('stackPlace');
    const corner = srng.int(4);
    const su = (corner & 1 ? 1 : -1) * Math.max(0, obb.halfLength - 3);
    const sv = (corner & 2 ? 1 : -1) * Math.max(0, obb.halfWidth - 3);
    const at = inBox(su, sv);
    const zRoof = spec.roof.shape === 'flat' ? eave : roofZ(at);
    if (zRoof !== null && free(at)) {
      const r0 = 1.0 + srng.next() * 0.3;
      const r1 = r0 * 0.75;
      const height = Math.max(14, eave * 1.6) + srng.next() * 8;
      const z0 = zRoof - 0.3;
      const z1 = eave + height;
      const round = srng.chance(0.6);
      const sides = round ? 8 : 4;
      const ring = (r: number): Vec2[] =>
        Array.from({ length: sides }, (_, k): Vec2 => {
          const a = ((k + 0.5) / sides) * 2 * Math.PI;
          const u = Math.round(Math.cos(a) * 1e6) / 1e6;
          const v = Math.round(Math.sin(a) * 1e6) / 1e6;
          return [
            at[0] + (obb.axis[0] * u + obb.side[0] * v) * r,
            at[1] + (obb.axis[1] * u + obb.side[1] * v) * r,
          ];
        });
      const brick = 0x9a5a48;
      const bottom = ring(r0);
      const top = ring(r1);
      for (let k = 0; k < sides; k++) {
        const j = (k + 1) % sides;
        mb.quad(
          world(bottom[k] as Vec2, z0),
          world(bottom[j] as Vec2, z0),
          world(top[j] as Vec2, z1 - 1.2),
          world(top[k] as Vec2, z1 - 1.2),
          brick,
        );
      }
      // Banded crown: a wider dark ring at the top.
      prism(ring(r1 * 1.18), z1 - 1.2, z1, shade(brick, 0.6), 0x222222);
      taken.push(ring(r0));
      count++;
    }
  }

  // --- Stores: a raised front over the street wall with a sign ---
  const street = walls[stage.streetWall ?? -1];
  if (
    spec.roof.shape === 'flat' &&
    street &&
    street.length >= 5 &&
    spec.base < 0.5 &&
    rng.fork('falseFront').chance(evalCurve(style.falseFront ?? 0, era))
  ) {
    const L = street.length;
    const f: Frame = {
      origin: world(street.a, eave),
      right: [street.dir[0], 0, -street.dir[1]],
      up: [0, 1, 0],
      normal: [street.normal[0], 0, -street.normal[1]],
      width: L,
      height: 3,
    };
    const rise = spec.roof.parapet + Math.min(2, Math.max(0.9, L * 0.1));
    const cap = palette.trim;
    const capSide = shade(cap, 0.85);
    const wallSide = shade(palette.wall, 0.85);
    // Old stores step up in the middle.
    const stepped = era < 0.5;
    const mid0 = L * 0.3;
    const mid1 = L * 0.7;
    const crest = stepped ? rise + 0.6 : rise;
    // Back faces too: the front is seen from the roof side as well.
    box(mb, f, 0, 0, L, rise, -0.25, 0.03, palette.wall, { bottom: false, back: true }, wallSide);
    box(mb, f, -0.05, rise, L + 0.05, rise + 0.12, -0.3, 0.08, cap, { back: true }, capSide);
    if (stepped) {
      box(mb, f, mid0, rise + 0.12, mid1, crest, -0.25, 0.03, palette.wall, { back: true }, wallSide);
      box(mb, f, mid0 - 0.05, crest, mid1 + 0.05, crest + 0.12, -0.3, 0.08, cap, { back: true }, capSide);
    }
    // The sign: a coloured panel, no text.
    const sw = Math.min(L * 0.6, 9);
    const s0 = (L - sw) / 2;
    const accent = palette.accent;
    box(
      mb,
      f,
      s0,
      rise * 0.25,
      s0 + sw,
      Math.min(crest - 0.15, rise * 0.25 + 0.9),
      0.03,
      0.12,
      accent,
      {},
      shade(accent, 0.8),
    );
    count++;
  }

  // --- Flat roofs: units and a stair head ---
  if (spec.roof.shape === 'flat' && rng.fork('clutter').chance(evalCurve(style.clutter ?? 0, era))) {
    const outer = spec.footprint.outer;
    const rings = [outer, ...spec.footprint.holes];
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
    const covered = stage.onRoof ?? [];
    const inside = (p: Vec2): boolean =>
      pointInRing(p, outer) && !spec.footprint.holes.some((h) => pointInRing(p, h));
    /** Distance to the nearest part standing on the roof; negative inside one. */
    const clearance = (p: Vec2): number => {
      let best = Number.POSITIVE_INFINITY;
      for (const ring of [...covered.map((poly) => poly.outer), ...taken]) {
        if (pointInRing(p, ring)) return -1;
        best = Math.min(best, distanceToRing(p, ring));
      }
      return best;
    };
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
        if (!inside(p) || edgeDistance(p) < r + 0.8 || clearance(p) < r + 0.6) continue;
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
