import { shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at, box, rect } from '../mesh/frame';
import type { PieceContext } from './types';

export const param = (ctx: PieceContext, name: string, fallback: number): number =>
  ctx.params[name] ?? fallback;

/** Wall rectangle, split into plinth colour below `ctx.plinth` and wall colour above. */
export function wallRect(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): void {
  const p = ctx.plinth;
  if (p > v0 + 1e-4 && p < v1 - 1e-4) {
    rect(mb, f, u0, v0, u1, p, ctx.palette.base);
    rect(mb, f, u0, p, u1, v1, ctx.wall);
  } else {
    rect(mb, f, u0, v0, u1, v1, p >= v1 - 1e-4 ? ctx.palette.base : ctx.wall);
  }
}

export interface Opening {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** The wall of a cell with a rectangular hole left open. */
export function wallAround(mb: MeshBuilder, f: Frame, ctx: PieceContext, o: Opening): void {
  wallRect(mb, f, ctx, 0, 0, o.u0, f.height); // left
  wallRect(mb, f, ctx, o.u1, 0, f.width, f.height); // right
  wallRect(mb, f, ctx, o.u0, 0, o.u1, o.v0); // below
  wallRect(mb, f, ctx, o.u0, o.v1, o.u1, f.height); // above
}

const BEAM = 0.16;
const PROUD = 0.03;

/**
 * Timber framing drawn on top of the wall: posts at the cell edges, rails at the
 * top and bottom, posts beside an opening, and a diagonal brace on blank cells.
 * Neighbouring cells each draw half a post so the joint reads as one beam.
 */
export function timberFrame(mb: MeshBuilder, f: Frame, ctx: PieceContext, opening: Opening | null): void {
  const c = ctx.palette.timber;
  const side = shade(c, 0.8);
  const w = f.width;
  const h = f.height;
  const half = BEAM / 2;
  const beam = (u0: number, v0: number, u1: number, v1: number): void =>
    box(mb, f, u0, v0, u1, v1, 0, PROUD, c, {}, side);
  beam(0, 0, half, h);
  beam(w - half, 0, w, h);
  beam(half, h - BEAM, w - half, h);
  if (ctx.plinth <= 0) beam(half, 0, w - half, half);
  if (opening) {
    beam(opening.u0 - BEAM, half, opening.u0, h - BEAM);
    beam(opening.u1, half, opening.u1 + BEAM, h - BEAM);
    if (opening.v0 > BEAM * 2) beam(opening.u0, opening.v0 - BEAM, opening.u1, opening.v0);
    if (h - BEAM - opening.v1 > BEAM * 1.5) beam(opening.u0, opening.v1, opening.u1, opening.v1 + BEAM);
  } else {
    // Mid rail and one diagonal brace; direction alternates with the seed.
    const mid = h * 0.5;
    beam(half, mid - half, w - half, mid + half);
    const flip = (ctx.seed & 1) === 1;
    const x0 = flip ? w - half : half;
    const x1 = flip ? half : w - half;
    const lo = ctx.plinth > 0 ? ctx.plinth : half;
    const dx = (flip ? -1 : 1) * BEAM * 1.2;
    mb.quad(
      at(f, Math.min(x0, x0 + dx), lo, PROUD),
      at(f, Math.max(x0, x0 + dx), lo, PROUD),
      at(f, Math.max(x1, x1 - dx), mid - half, PROUD),
      at(f, Math.min(x1, x1 - dx), mid - half, PROUD),
      c,
    );
  }
}
