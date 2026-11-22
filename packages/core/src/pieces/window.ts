import { type Colour, shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at, box, recess, rect } from '../mesh/frame';
import { type Opening, param, timberFrame, wallAround, wallRect } from './common';
import type { Piece, PieceContext } from './types';

const ARCH_SEGMENTS = 4;

/**
 * Opening with a segmental arch on top: wall around it, reveals, soffit and the back.
 * `rise` is the arch height above the springing line `o.v1 - rise`. Returns the
 * springing line and the arch top as a function of u.
 */
function archedOpening(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  o: Opening,
  rise: number,
  depth: number,
  reveal: Colour,
  back: Colour,
): { spring: number; top: (u: number) => number } {
  const { u0, v0, u1, v1 } = o;
  const spring = v1 - rise;
  const half = (u1 - u0) / 2;
  const mid = u0 + half;
  const r = (half * half + rise * rise) / (2 * rise);
  const cy = v1 - r;
  const top = (u: number): number => cy + Math.sqrt(Math.max(0, r * r - (u - mid) * (u - mid)));
  wallRect(mb, f, ctx, 0, 0, u0, f.height);
  wallRect(mb, f, ctx, u1, 0, f.width, f.height);
  wallRect(mb, f, ctx, u0, 0, u1, v0);
  const d = -depth;
  mb.quad(at(f, u0, v0, 0), at(f, u0, v0, d), at(f, u0, spring, d), at(f, u0, spring, 0), reveal);
  mb.quad(at(f, u1, v0, d), at(f, u1, v0, 0), at(f, u1, spring, 0), at(f, u1, spring, d), reveal);
  mb.quad(at(f, u0, v0, 0), at(f, u1, v0, 0), at(f, u1, v0, d), at(f, u0, v0, d), reveal);
  rect(mb, f, u0, v0, u1, spring, back, d);
  for (let i = 0; i < ARCH_SEGMENTS; i++) {
    const a = u0 + ((u1 - u0) * i) / ARCH_SEGMENTS;
    const b = u0 + ((u1 - u0) * (i + 1)) / ARCH_SEGMENTS;
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
 */
export const window: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const band = param(ctx, 'w', 0.45) >= 0.99;
  const ow = band ? W : Math.min(W - 0.3, W * param(ctx, 'w', 0.45));
  const u0 = (W - ow) / 2;
  const u1 = u0 + ow;
  const v0 = Math.max(
    H * param(ctx, 'sill', 0.3),
    ctx.plinth > 0 ? Math.min(ctx.plinth + 0.05, H * 0.5) : 0.04,
  );
  const v1 = Math.min(H - 0.12, v0 + H * param(ctx, 'h', 0.5));
  if (ow < 0.2 || v1 - v0 < 0.2) {
    wallAround(mb, f, ctx, { u0: 0, v0: 0, u1: 0, v1: 0 });
    return;
  }
  const o: Opening = { u0, v0, u1, v1 };
  const depth = 0.12;
  const frameColour = ctx.palette.frame;
  const louvre = param(ctx, 'louvre', 0) >= 1;
  const back = louvre ? shade(ctx.wall, 0.45) : ctx.palette.glass;
  const rise = band || ctx.timber ? 0 : Math.min(param(ctx, 'arch', 0) * ow, (v1 - v0) * 0.4);
  const arched = rise > 0.05 ? archedOpening(mb, f, ctx, o, rise, depth, frameColour, back) : null;
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
  const nh = Math.round(param(ctx, 'mullionH', 0));
  for (let i = 1; i <= nh; i++) {
    // Horizontal bars sit in the upper part, like a transom.
    const v =
      arched && i === nh ? vTop : nh === 1 ? v0 + (v1 - v0) * 0.68 : v0 + ((vTop - v0) * i) / (nh + 1);
    box(mb, f, u0, v - bar / 2, u1, v + bar / 2, -depth, -depth + 0.03, barColour, {
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
      for (let i = 0; i < ARCH_SEGMENTS; i++) {
        const a = u0 + ((u1 - u0) * i) / ARCH_SEGMENTS;
        const b = u0 + ((u1 - u0) * (i + 1)) / ARCH_SEGMENTS;
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
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};
