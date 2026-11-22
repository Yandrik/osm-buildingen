import { shade } from '../colour';
import { box, recess } from '../mesh/frame';
import { type Opening, param, timberFrame, wallAround } from './common';
import type { Piece } from './types';

/**
 * Window in a recess.
 * Params (fractions of the cell unless noted):
 *   w, h      opening size; w >= 0.99 makes a band that runs into the neighbours
 *   sill      distance of the opening's bottom from the cell bottom
 *   frame     1 = raised trim around the opening
 *   mullionV  number of vertical bars; mullionH: horizontal bars
 *   sillBox   1 = projecting sill
 *   shutters  1 = shutters left and right
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
  wallAround(mb, f, ctx, o);

  const depth = 0.12;
  const frameColour = ctx.palette.frame;
  recess(mb, f, u0, v0, u1, v1, depth, frameColour, ctx.palette.glass);

  // Bars sit just in front of the glass.
  const bar = 0.05;
  const barColour = frameColour;
  const nv = Math.round(param(ctx, 'mullionV', 0));
  for (let i = 1; i <= nv; i++) {
    const u = u0 + (ow * i) / (nv + 1);
    box(mb, f, u - bar / 2, v0, u + bar / 2, v1, -depth, -depth + 0.03, barColour, {
      top: false,
      bottom: false,
    });
  }
  const nh = Math.round(param(ctx, 'mullionH', 0));
  for (let i = 1; i <= nh; i++) {
    // Horizontal bars sit in the upper part, like a transom.
    const v = nh === 1 ? v0 + (v1 - v0) * 0.68 : v0 + ((v1 - v0) * i) / (nh + 1);
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
    box(mb, f, u0 - t, v0, u0, v1, 0, d, trim, {}, trimSide);
    box(mb, f, u1, v0, u1 + t, v1, 0, d, trim, {}, trimSide);
    box(mb, f, u0 - t, v1, u1 + t, v1 + t, 0, d, trim, {}, trimSide);
  }
  if (param(ctx, 'sillBox', 0) >= 1 && !band && v0 > 0.12) {
    box(mb, f, u0 - 0.07, v0 - 0.07, u1 + 0.07, v0, 0, 0.09, trim, {}, trimSide);
  }
  if (param(ctx, 'shutters', 0) >= 1 && !band) {
    const sw = Math.min(ow / 2, u0 - 0.06);
    if (sw > 0.15) {
      const c = ctx.palette.accent;
      box(mb, f, u0 - sw - 0.02, v0, u0 - 0.02, v1, 0, 0.04, c, {}, shade(c, 0.8));
      box(mb, f, u1 + 0.02, v0, u1 + sw + 0.02, v1, 0, 0.04, c, {}, shade(c, 0.8));
    }
  }
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};
