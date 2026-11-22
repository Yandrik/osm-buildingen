import { shade } from '../colour';
import { box, recess, rect } from '../mesh/frame';
import { param, wallRect } from './common';
import type { Piece } from './types';

/**
 * Shop window from a low base up to a sign band. Runs edge to edge so neighbouring
 * cells form one front. Params: base = base height in metres, door = 1 adds a glazed door.
 */
export const shopfront: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const base = Math.min(param(ctx, 'base', 0.4), H * 0.25);
  const sign = Math.min(0.55, H * 0.16);
  const top = H - sign - 0.12;
  const post = 0.1;
  const hasDoor = param(ctx, 'door', 0) >= 1;

  // Wall: base strip, posts, lintel.
  wallRect(mb, f, { ...ctx, plinth: H }, post, 0, W - post, hasDoor ? 0 : base);
  wallRect(mb, f, ctx, 0, 0, post, H);
  wallRect(mb, f, ctx, W - post, 0, W, H);
  wallRect(mb, f, ctx, post, top, W - post, H);

  const depth = 0.1;
  const frame = ctx.palette.frame;
  const v0 = hasDoor ? 0 : base;
  recess(mb, f, post, v0, W - post, top, depth, frame, ctx.palette.glass);
  if (hasDoor) {
    const dw = Math.min(1.1, W - 2 * post - 0.2);
    const a = (W - dw) / 2;
    // Door frame bars in front of the glass.
    for (const u of [a, a + dw])
      box(mb, f, u - 0.03, 0, u + 0.03, top, -depth, -depth + 0.04, frame, { top: false, bottom: false });
    box(mb, f, a, 2.1, a + dw, 2.16, -depth, -depth + 0.04, frame, { left: false, right: false });
    // Base strips beside the door.
    rect(mb, f, post, 0, a - 0.03, base, ctx.palette.base, -depth + 0.02);
    rect(mb, f, a + dw + 0.03, 0, W - post, base, ctx.palette.base, -depth + 0.02);
  }
  // Sign band: a slim coloured box, no text.
  const c = ctx.palette.accent;
  box(mb, f, 0, top + 0.08, W, top + 0.08 + sign, 0, 0.06, c, { left: false, right: false }, shade(c, 0.8));
};
