import { shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at } from '../mesh/frame';
import { wallRect } from './common';
import type { PieceContext } from './types';

/** How deep the dark recess behind a passage opening is. */
const DEPTH = 1.6;
const SEGMENTS = 5;

/**
 * One facade cell of a passage (a road going through the building).
 *
 * The opening can span several cells, so its position is given in cell-local
 * coordinates and may start before 0 or end after the cell width:
 *   from, to  left and right edge of the whole opening (metres, cell-local)
 *   height    clear height at the middle of the opening
 * The top is a flat segmental arch. The inside is a dark recess, not a real tunnel.
 */
export function arch(mb: MeshBuilder, f: Frame, ctx: PieceContext): void {
  const W = f.width;
  const H = f.height;
  const from = ctx.params.from ?? 0;
  const to = ctx.params.to ?? W;
  const clear = Math.min(H - 0.25, ctx.params.height ?? 3.5);
  const u0 = Math.max(0, from);
  const u1 = Math.min(W, to);
  if (u1 - u0 < 0.05) {
    wallRect(mb, f, ctx, 0, 0, W, H);
    return;
  }
  // Arch: springs at 78 % of the clear height, rises to `clear` in the middle.
  const centre = (from + to) / 2;
  const half = (to - from) / 2;
  const spring = clear * 0.78;
  const top = (u: number): number => {
    const x = Math.min(1, Math.abs(u - centre) / half);
    return spring + (clear - spring) * Math.sqrt(Math.max(0, 1 - x * x));
  };

  wallRect(mb, f, ctx, 0, 0, u0, H);
  wallRect(mb, f, ctx, u1, 0, W, H);

  const dark = shade(ctx.wall, 0.3);
  const reveal = shade(ctx.wall, 0.62);
  const trim = ctx.palette.trim;
  for (let i = 0; i < SEGMENTS; i++) {
    const a = u0 + ((u1 - u0) * i) / SEGMENTS;
    const b = u0 + ((u1 - u0) * (i + 1)) / SEGMENTS;
    const ha = top(a);
    const hb = top(b);
    // Wall above the arch, with a slim trim band following the curve.
    const band = Math.min(0.22, H - Math.max(ha, hb) - 0.02);
    mb.quad(at(f, a, ha + band), at(f, b, hb + band), at(f, b, H), at(f, a, H), ctx.wall);
    if (band > 0.03)
      mb.quad(
        at(f, a, ha, 0.03),
        at(f, b, hb, 0.03),
        at(f, b, hb + band, 0.03),
        at(f, a, ha + band, 0.03),
        trim,
      );
    // Soffit and the dark back.
    mb.quad(at(f, a, ha, -DEPTH), at(f, b, hb, -DEPTH), at(f, b, hb, 0), at(f, a, ha, 0), reveal);
    mb.quad(at(f, a, 0, -DEPTH), at(f, b, 0, -DEPTH), at(f, b, hb, -DEPTH), at(f, a, ha, -DEPTH), dark);
  }
  // Side reveals only where the opening really ends inside this cell.
  if (from >= 0)
    mb.quad(at(f, u0, 0, 0), at(f, u0, 0, -DEPTH), at(f, u0, top(u0), -DEPTH), at(f, u0, top(u0), 0), reveal);
  if (to <= W)
    mb.quad(at(f, u1, 0, -DEPTH), at(f, u1, 0, 0), at(f, u1, top(u1), 0), at(f, u1, top(u1), -DEPTH), reveal);
  // Ground inside the passage, slightly raised so it reads as paving.
  mb.quad(
    at(f, u0, 0.02, 0),
    at(f, u1, 0.02, 0),
    at(f, u1, 0.02, -DEPTH),
    at(f, u0, 0.02, -DEPTH),
    shade(ctx.palette.base, 0.8),
  );
}
