import { type Colour, shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at, box, recess, rect, subFrame } from '../mesh/frame';
import { type Opening, param, timberFrame, wallAround, wallRect } from './common';
import type { Piece, PieceContext } from './types';

const ARCH_SEGMENTS = 4;
/** Cell widths from which a `twin` window is drawn twice, and three times. */
const TWIN = 3.2;
const TRIPLET = 6.5;

/**
 * The arch line over an opening from u0 to u1 whose crown is at v1 and springing at
 * v1 - rise. Up to half the width it is a segmental (or, at exactly half, a round)
 * arch. A `pointed` arch taller than that is two arcs meeting at the crown, each
 * centred on the springing line on the far side of the middle (gothic).
 */
export function archLine(
  u0: number,
  u1: number,
  v1: number,
  rise: number,
  pointed: boolean,
): (u: number) => number {
  const half = (u1 - u0) / 2;
  const mid = u0 + half;
  const spring = v1 - rise;
  if (pointed && rise > half) {
    // Left arc through (u0, spring) and (mid, v1), centre (cx, spring).
    const cx = (mid * mid - u0 * u0 + rise * rise) / (2 * half);
    const r = cx - u0;
    return (u: number): number => {
      const x = u <= mid ? u : 2 * mid - u;
      return spring + Math.sqrt(Math.max(0, r * r - (x - cx) * (x - cx)));
    };
  }
  const r = (half * half + rise * rise) / (2 * rise);
  const cy = v1 - r;
  return (u: number): number => cy + Math.sqrt(Math.max(0, r * r - (u - mid) * (u - mid)));
}

/**
 * Opening with an arch on top (see `archLine`): wall around it, reveals, soffit and
 * the back. `rise` is the arch height above the springing line `o.v1 - rise`. Returns
 * the springing line and the arch top as a function of u.
 */
function archedOpening(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  o: Opening,
  rise: number,
  pointed: boolean,
  depth: number,
  reveal: Colour,
  back: Colour,
  segments: number,
): { spring: number; top: (u: number) => number } {
  const { u0, v0, u1, v1 } = o;
  const spring = v1 - rise;
  const top = archLine(u0, u1, v1, rise, pointed);
  wallRect(mb, f, ctx, 0, 0, u0, f.height);
  wallRect(mb, f, ctx, u1, 0, f.width, f.height);
  wallRect(mb, f, ctx, u0, 0, u1, v0);
  const d = -depth;
  mb.quad(at(f, u0, v0, 0), at(f, u0, v0, d), at(f, u0, spring, d), at(f, u0, spring, 0), reveal);
  mb.quad(at(f, u1, v0, d), at(f, u1, v0, 0), at(f, u1, spring, 0), at(f, u1, spring, d), reveal);
  mb.quad(at(f, u0, v0, 0), at(f, u1, v0, 0), at(f, u1, v0, d), at(f, u0, v0, d), reveal);
  rect(mb, f, u0, v0, u1, spring, back, d);
  for (let i = 0; i < segments; i++) {
    const a = u0 + ((u1 - u0) * i) / segments;
    const b = u0 + ((u1 - u0) * (i + 1)) / segments;
    const ha = top(a);
    const hb = top(b);
    mb.quad(at(f, a, ha), at(f, b, hb), at(f, b, f.height), at(f, a, f.height), ctx.wall);
    mb.quad(at(f, a, ha, d), at(f, b, hb, d), at(f, b, hb, 0), at(f, a, ha, 0), reveal);
    mb.quad(at(f, a, spring, d), at(f, b, spring, d), at(f, b, hb, d), at(f, a, ha, d), back);
  }
  return { spring, top };
}

/**
 * Window in a recess.
 * Params (fractions of the cell unless noted):
 *   w, h      opening size; w >= 0.99 makes a band that runs into the neighbours
 *   sill      distance of the opening's bottom from the cell bottom
 *   frame     1 = raised trim around the opening
 *   mullionV  number of vertical bars; mullionH: horizontal bars
 *   sillBox   1 = projecting sill
 *   shutters  1 = shutters left and right
 *   fins      depth in metres of vertical ribs at both cell edges (finW = rib width);
 *             neighbouring cells each draw half a rib, so the ribs run over the whole wall
 *   louvre    1 = dark slatted vent instead of glass (plant storeys)
 *   arch      rise of a segmental arch over the opening, as a fraction of its width
 *             (0.5 = round arch)
 *   pointed   1 = a rise above half the width makes a pointed (gothic) arch
 *   twin      1 = in a wide cell the opening is drawn two or three times side by side
 *             (belfries)
 *   segments  straight pieces the arch is drawn with (default 4)
 *   slim      widest the opening may be, as a fraction of its height (tall church
 *             windows stay slender in a low wall)
 *   tracery   1 = the mullion forks into the arch (gothic Y-tracery); needs mullionV 1
 *   buttress  depth in metres of a stepped buttress at both cell edges (half in each
 *             neighbouring cell, like fins); it steps back to half depth halfway up.
 *             `edgeL` / `edgeR` = 0 (set per cell by the layout) leave that edge bare
 */
export const window: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const twin = param(ctx, 'twin', 0) >= 1 ? (W >= TRIPLET ? 3 : W >= TWIN ? 2 : 1) : 1;
  if (twin > 1) {
    // Two or three openings side by side: the same window drawn in each share of the cell.
    const single = { ...ctx, params: { ...ctx.params, twin: 0 } };
    for (let i = 0; i < twin; i++)
      window(mb, subFrame(f, (W * i) / twin, 0, (W * (i + 1)) / twin, H), single);
    return;
  }
  const band = param(ctx, 'w', 0.45) >= 0.99;
  const v0 = Math.max(
    H * param(ctx, 'sill', 0.3),
    ctx.plinth > 0 ? Math.min(ctx.plinth + 0.05, H * 0.5) : 0.04,
  );
  const v1 = Math.min(H - 0.12, v0 + H * param(ctx, 'h', 0.5));
  const slim = param(ctx, 'slim', 0);
  const wide = band ? W : Math.min(W - 0.3, W * param(ctx, 'w', 0.45));
  const ow = slim > 0 && !band ? Math.min(wide, (v1 - v0) * slim) : wide;
  const u0 = (W - ow) / 2;
  const u1 = u0 + ow;
  if (ow < 0.2 || v1 - v0 < 0.2) {
    wallAround(mb, f, ctx, { u0: 0, v0: 0, u1: 0, v1: 0 });
    return;
  }
  const o: Opening = { u0, v0, u1, v1 };
  const depth = 0.12;
  const frameColour = ctx.palette.frame;
  const louvre = param(ctx, 'louvre', 0) >= 1;
  const back = louvre ? shade(ctx.wall, 0.45) : ctx.palette.glass;
  const pointed = param(ctx, 'pointed', 0) >= 1;
  const rise = band || ctx.timber ? 0 : Math.min(param(ctx, 'arch', 0) * ow, (v1 - v0) * 0.4);
  const segments = Math.max(2, Math.round(param(ctx, 'segments', ARCH_SEGMENTS)));
  const arched =
    rise > 0.05 ? archedOpening(mb, f, ctx, o, rise, pointed, depth, frameColour, back, segments) : null;
  if (!arched) {
    wallAround(mb, f, ctx, o);
    recess(mb, f, u0, v0, u1, v1, depth, frameColour, back);
  }
  /** Top of the rectangular part: bars and side trim stop at the springing line. */
  const vTop = arched ? arched.spring : v1;
  if (louvre) {
    // Slats: thin boxes leaning out of the recess.
    const slats = Math.max(2, Math.round((v1 - v0) / 0.3));
    const slat = shade(ctx.wall, 0.8);
    for (let i = 1; i < slats; i++) {
      const v = v0 + ((v1 - v0) * i) / slats;
      box(mb, f, u0, v - 0.04, u1, v + 0.04, -depth, -0.02, slat, { left: false, right: false });
    }
  }

  // Bars sit just in front of the glass.
  const bar = 0.05;
  const barColour = frameColour;
  const nv = Math.round(param(ctx, 'mullionV', 0));
  for (let i = 1; i <= nv; i++) {
    const u = u0 + (ow * i) / (nv + 1);
    box(mb, f, u - bar / 2, v0, u + bar / 2, vTop, -depth, -depth + 0.03, barColour, {
      top: false,
      bottom: false,
    });
  }
  if (arched && nv === 1 && param(ctx, 'tracery', 0) >= 1) {
    // Y-tracery: from the top of the mullion two bars lean out to the arch at its quarter points.
    const mid = (u0 + u1) / 2;
    const d = -depth + 0.03;
    for (const sign of [-1, 1] as const) {
      const u = mid + (sign * ow) / 4;
      const top = arched.top(u);
      // Left bar and right bar are mirror images; both are wound counter-clockwise seen from outside.
      const a = at(f, mid - bar / 2, vTop, d);
      const b = at(f, mid + bar / 2, vTop, d);
      const c = at(f, u + bar / 2, top, d);
      const e = at(f, u - bar / 2, top, d);
      mb.quad(a, b, c, e, barColour);
    }
  }
  const nh = Math.round(param(ctx, 'mullionH', 0));
  for (let i = 1; i <= nh; i++) {
    // Horizontal bars sit in the upper part, like a transom.
    const v =
      arched && i === nh ? vTop : nh === 1 ? v0 + (v1 - v0) * 0.68 : v0 + ((vTop - v0) * i) / (nh + 1);
    // A little behind the vertical bars, so their fronts do not share a plane where they cross.
    box(mb, f, u0, v - bar / 2, u1, v + bar / 2, -depth, -depth + 0.025, barColour, {
      left: false,
      right: false,
    });
  }

  const trim = ctx.palette.trim;
  const trimSide = shade(trim, 0.85);
  if (param(ctx, 'frame', 0) >= 1 && !band && !ctx.timber) {
    const t = 0.09;
    const d = 0.035;
    box(mb, f, u0 - t, v0, u0, vTop, 0, d, trim, {}, trimSide);
    box(mb, f, u1, v0, u1 + t, vTop, 0, d, trim, {}, trimSide);
    if (arched) {
      // Band following the arch, and a keystone.
      const arc = Math.min(t * 1.6, H - v1 - 0.02);
      for (let i = 0; i < segments; i++) {
        const a = u0 + ((u1 - u0) * i) / segments;
        const b = u0 + ((u1 - u0) * (i + 1)) / segments;
        const ha = arched.top(a);
        const hb = arched.top(b);
        mb.quad(at(f, a, ha, d), at(f, b, hb, d), at(f, b, hb + arc, d), at(f, a, ha + arc, d), trim);
      }
      const k = (u0 + u1) / 2;
      box(
        mb,
        f,
        k - 0.1,
        v1 - 0.04,
        k + 0.1,
        Math.min(H - 0.02, v1 + arc + 0.06),
        0,
        d + 0.02,
        trim,
        {},
        trimSide,
      );
    } else box(mb, f, u0 - t, v1, u1 + t, v1 + t, 0, d, trim, {}, trimSide);
  }
  if (param(ctx, 'sillBox', 0) >= 1 && !band && v0 > 0.12) {
    box(mb, f, u0 - 0.07, v0 - 0.07, u1 + 0.07, v0, 0, 0.09, trim, {}, trimSide);
  }
  if (param(ctx, 'shutters', 0) >= 1 && !band && !arched) {
    const sw = Math.min(ow / 2, u0 - 0.06);
    if (sw > 0.15) {
      const c = ctx.palette.accent;
      box(mb, f, u0 - sw - 0.02, v0, u0 - 0.02, v1, 0, 0.04, c, {}, shade(c, 0.8));
      box(mb, f, u1 + 0.02, v0, u1 + sw + 0.02, v1, 0, 0.04, c, {}, shade(c, 0.8));
    }
  }
  const fins = param(ctx, 'fins', 0);
  if (fins > 0.01) {
    const half = Math.min(u0, param(ctx, 'finW', 0.4)) / 2;
    const c = ctx.wall;
    const side = shade(c, 0.84);
    box(mb, f, 0, 0, half, H, 0, fins, c, { bottom: false }, side);
    box(mb, f, W - half, 0, W, H, 0, fins, c, { bottom: false }, side);
  }
  const buttress = param(ctx, 'buttress', 0);
  if (buttress > 0.01) {
    const half = Math.min(u0 - 0.05, 0.45);
    if (half > 0.1) {
      const c = ctx.wall;
      const side = shade(c, 0.84);
      const cap = shade(c, 0.78);
      const step = H * 0.5;
      const top = H * 0.9;
      const slope = Math.min(0.9, H * 0.06);
      for (const [a, b, edge] of [
        [0, half, 'edgeL'],
        [W - half, W, 'edgeR'],
      ] as const) {
        if (param(ctx, edge, 1) < 1) continue;
        box(mb, f, a, 0, b, step - slope, 0, buttress, c, { bottom: false, top: false }, side);
        box(
          mb,
          f,
          a,
          step - slope,
          b,
          top - slope,
          0,
          buttress * 0.5,
          c,
          { bottom: false, top: false },
          side,
        );
        // Weatherings: each offset ends in a slope back to the wall behind it.
        for (const [v, d0, d1] of [
          [step - slope, buttress * 0.5, buttress],
          [top - slope, 0, buttress * 0.5],
        ] as const) {
          mb.quad(at(f, a, v, d1), at(f, b, v, d1), at(f, b, v + slope, d0), at(f, a, v + slope, d0), cap);
          mb.tri(at(f, a, v, d0), at(f, a, v, d1), at(f, a, v + slope, d0), side);
          mb.tri(at(f, b, v, d1), at(f, b, v, d0), at(f, b, v + slope, d0), side);
        }
      }
    }
  }
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};
