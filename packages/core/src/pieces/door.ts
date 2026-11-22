import { shade } from '../colour';
import { at, box, recess, rect } from '../mesh/frame';
import { param, timberFrame, wallAround } from './common';
import type { Piece } from './types';

/**
 * Entrance door.
 * Params: w, h in metres; glass = share of the leaf that is glazed (from the top);
 * canopy = 1 small canopy, 2 deep canopy across the whole cell (tower lobbies);
 * step, double = 0/1.
 */
export const door: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const ow = Math.min(W - 0.3, param(ctx, 'w', 1.0));
  const oh = Math.min(H - 0.25, param(ctx, 'h', 2.1));
  const u0 = (W - ow) / 2;
  const u1 = u0 + ow;
  const o = { u0, v0: 0, u1, v1: oh };
  wallAround(mb, f, ctx, o);

  const depth = 0.16;
  const leaf = ctx.palette.door;
  recess(mb, f, u0, 0, u1, oh, depth, ctx.palette.frame, leaf);

  const glass = param(ctx, 'glass', 0);
  const d = -depth + 0.012;
  const double = param(ctx, 'double', 0) >= 1;
  const leaves = double ? 2 : 1;
  const lw = ow / leaves;
  for (let i = 0; i < leaves; i++) {
    const a = u0 + i * lw;
    const m = Math.min(0.12, lw * 0.14);
    if (glass > 0.02) {
      const gv1 = oh - m;
      const gv0 = Math.max(m, gv1 - (oh - 2 * m) * glass);
      rect(mb, f, a + m, gv0, a + lw - m, gv1, ctx.palette.glass, d);
    } else {
      // Two sunk panels read as a solid door.
      const c = shade(leaf, 0.88);
      rect(mb, f, a + m, oh * 0.55, a + lw - m, oh - m, c, d);
      rect(mb, f, a + m, m, a + lw - m, oh * 0.48, c, d);
    }
  }

  const trim = ctx.palette.trim;
  const trimSide = shade(trim, 0.85);
  if (param(ctx, 'step', 0) >= 1)
    box(mb, f, u0 - 0.15, 0, u1 + 0.15, 0.1, 0, 0.4, shade(ctx.palette.base, 0.95));
  if (param(ctx, 'porch', 0) >= 1 && H - oh > 0.45 && ctx.era < 0.85) {
    // Porch: slab, two posts and a small roof. Modern houses (era > 0.85) keep a plain canopy.
    const reach = 1.3;
    const pw = Math.min(W - 0.1, ow + 1.3);
    const a = (W - pw) / 2;
    const top = oh + 0.25;
    box(mb, f, a, 0, a + pw, 0.14, 0, reach, shade(ctx.palette.base, 0.95));
    for (const u of [a + 0.06, a + pw - 0.2])
      box(mb, f, u, 0.14, u + 0.14, top, reach - 0.2, reach - 0.06, trim, { back: true }, trimSide);
    box(mb, f, a - 0.1, top, a + pw + 0.1, top + 0.14, 0, reach + 0.1, trim, {}, trimSide);
    // Lean-to roof from the wall down to the front edge.
    mb.quad(
      at(f, a - 0.1, top + 0.14, reach + 0.1),
      at(f, a + pw + 0.1, top + 0.14, reach + 0.1),
      at(f, a + pw + 0.1, top + 0.55, 0),
      at(f, a - 0.1, top + 0.55, 0),
      ctx.palette.roof,
    );
  } else if (param(ctx, 'canopy', 0) >= 2 && H - oh > 0.6) {
    // Lobby canopy: a deep slab over the whole cell with a fascia.
    const reach = Math.min(3, Math.max(1.8, W * 0.6));
    const v = Math.min(H - 0.35, oh + 0.45);
    box(mb, f, 0.05, v, W - 0.05, v + 0.3, 0, reach, trim, { back: false }, trimSide);
  } else if ((param(ctx, 'canopy', 0) >= 1 || param(ctx, 'porch', 0) >= 1) && H - oh > 0.45) {
    const reach = ctx.era > 0.6 ? 0.9 : 0.6;
    box(mb, f, u0 - 0.25, oh + 0.12, u1 + 0.25, oh + 0.2, 0, reach, trim, { back: false }, trimSide);
  } else if (!ctx.timber && ctx.era < 0.5) {
    // Older doors get a raised surround instead of a canopy.
    box(mb, f, u0 - 0.1, 0, u0, oh, 0, 0.04, trim, {}, trimSide);
    box(mb, f, u1, 0, u1 + 0.1, oh, 0, 0.04, trim, {}, trimSide);
    box(mb, f, u0 - 0.1, oh, u1 + 0.1, oh + 0.1, 0, 0.04, trim, {}, trimSide);
  }
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};

/** Height of a truck bed: the sill of a loading dock door. */
const DOCK_SILL = 1.15;

/**
 * Garage or roller door. Params: w = fraction of the cell width, h in metres,
 * lines = number of horizontal panels; dock = 1 makes a loading dock: the door
 * raised to truck-bed height, rubber bumpers and a canopy above.
 */
export const garageDoor: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const ow = Math.min(W - 0.24, W * param(ctx, 'w', 0.84));
  const dock = param(ctx, 'dock', 0) >= 1 && H > DOCK_SILL + 2.6;
  const v0 = dock ? DOCK_SILL : 0;
  const oh = Math.min(H - 0.2 - (dock ? 0.6 : 0), v0 + param(ctx, 'h', 2.1));
  const u0 = (W - ow) / 2;
  const u1 = u0 + ow;
  wallAround(mb, f, ctx, { u0, v0, u1, v1: oh });
  const depth = 0.1;
  const leaf = ctx.palette.door;
  recess(mb, f, u0, v0, u1, oh, depth, ctx.palette.frame, leaf);
  // Alternating shades give the panel lines without extra geometry depth.
  const lines = Math.max(1, Math.round(param(ctx, 'lines', 4)));
  for (let i = 0; i < lines; i += 2) {
    const a = v0 + ((oh - v0) * i) / lines;
    const b = v0 + ((oh - v0) * (i + 1)) / lines;
    rect(mb, f, u0, a, u1, b, shade(leaf, 0.92), -depth + 0.01);
  }
  if (dock) {
    // Bumpers either side of the sill, a dark seal round the door, a canopy above.
    const rubber = 0x2b2b2b;
    for (const u of [u0 + 0.1, u1 - 0.35])
      box(mb, f, u, DOCK_SILL - 0.45, u + 0.25, DOCK_SILL - 0.05, 0, 0.22, rubber);
    box(mb, f, u0 - 0.18, v0, u0, oh + 0.18, 0, 0.12, rubber, { bottom: false });
    box(mb, f, u1, v0, u1 + 0.18, oh + 0.18, 0, 0.12, rubber, { bottom: false });
    box(mb, f, u0, oh, u1, oh + 0.18, 0, 0.12, rubber, { left: false, right: false });
    const trim = ctx.palette.trim;
    box(mb, f, u0 - 0.4, oh + 0.35, u1 + 0.4, oh + 0.5, 0, 1.6, trim, { back: false }, shade(trim, 0.8));
  }
};
