import { shade } from '../colour';
import { box, recess } from '../mesh/frame';
import { param, timberFrame, wallAround } from './common';
import type { Piece } from './types';

/** Balcony: glazed door, slab and a solid railing. Params: depth in metres. */
export const balcony: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const ow = Math.min(W - 0.5, Math.max(0.9, W * 0.45));
  const u0 = (W - ow) / 2;
  const u1 = u0 + ow;
  const o = { u0, v0: 0.04, u1, v1: Math.min(H - 0.3, 2.25) };
  wallAround(mb, f, ctx, o);
  recess(mb, f, o.u0, o.v0, o.u1, o.v1, 0.12, ctx.palette.frame, ctx.palette.glass);
  box(mb, f, (u0 + u1) / 2 - 0.025, o.v0, (u0 + u1) / 2 + 0.025, o.v1, -0.12, -0.09, ctx.palette.frame, {
    top: false,
    bottom: false,
  });

  const depth = param(ctx, 'depth', 1.1);
  const inset = 0.1;
  const slab = shade(ctx.palette.trim, 0.9);
  box(mb, f, inset, -0.14, W - inset, 0, 0, depth, slab);
  // Railing: three thin panels. Modern buildings get a glass front.
  const rail = ctx.era > 0.8 ? ctx.palette.glass : ctx.palette.trim;
  const railSide = shade(ctx.palette.trim, 0.85);
  const rh = 0.95;
  const t = 0.05;
  box(mb, f, inset, 0, W - inset, rh, depth - t, depth, rail, { back: true }, railSide);
  box(mb, f, inset, 0, inset + t, rh, 0, depth - t, railSide, { back: true });
  box(mb, f, W - inset - t, 0, W - inset, rh, 0, depth - t, railSide, { back: true });
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};
