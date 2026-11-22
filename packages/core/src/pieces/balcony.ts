import { type Colour, shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at, box, recess, rect } from '../mesh/frame';
import type { CellBalcony } from '../pipeline/facade/balconies';
import type { Palette, ResolvedBalcony } from '../types';
import { timberFrame, wallAround } from './common';
import type { Piece } from './types';

/** Glazed door onto a balcony. The slab and railing are drawn by `addBalcony`. */
export const balconyDoor: Piece = (mb, f, ctx) => {
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
  if (ctx.timber) timberFrame(mb, f, ctx, o);
};

const SLAB = 0.14;
/** Gap between the slab end and the cell edge where a balcony stops. */
const INSET = 0.1;
const RAIL_HEIGHT = 0.95;

/**
 * A straight run of railing in its own frame: u along the run, outside face at d = 0,
 * inside towards negative d. Both faces are drawn so the far side of a balcony shows
 * through bars and boards.
 */
function railingRun(
  mb: MeshBuilder,
  f: Frame,
  length: number,
  b: ResolvedBalcony,
  palette: Palette,
  era: number,
): void {
  const h = RAIL_HEIGHT;
  const both = { back: true };
  switch (b.railing) {
    case 'solid': {
      box(mb, f, 0, 0, length, h, -0.05, 0, palette.trim, both, shade(palette.trim, 0.85));
      return;
    }
    case 'glass': {
      const rail = palette.frame;
      box(mb, f, 0, 0.06, length, h - 0.05, -0.03, -0.01, palette.glass, both);
      box(mb, f, 0, h - 0.05, length, h, -0.05, 0, rail, both, shade(rail, 0.85));
      return;
    }
    case 'bars': {
      const c = b.colour;
      const side = shade(c, 0.8);
      box(mb, f, 0, h - 0.04, length, h, -0.05, 0, c, both, side);
      box(mb, f, 0, 0.06, length, 0.1, -0.04, -0.01, c, both, side);
      // Flat bars, front and back only: their sides are too thin to see.
      const n = Math.max(2, Math.round(length / 0.2));
      for (let i = 0; i <= n; i++) {
        const u = Math.min(length - 0.02, Math.max(0, (length * i) / n - 0.01));
        rect(mb, f, u, 0.1, u + 0.02, h - 0.04, c, -0.025);
        mb.quad(
          at(f, u + 0.02, 0.1, -0.025),
          at(f, u, 0.1, -0.025),
          at(f, u, h - 0.04, -0.025),
          at(f, u + 0.02, h - 0.04, -0.025),
          side,
        );
      }
      return;
    }
    case 'wood': {
      const c = b.colour;
      const side = shade(c, 0.8);
      box(mb, f, 0, h - 0.06, length, h, -0.07, 0, c, both, side);
      if (era < 0.5) {
        // Vertical boards, the older alpine look.
        const n = Math.max(1, Math.round(length / 0.14));
        const w = (length / n) * 0.72;
        for (let i = 0; i < n; i++) {
          const u = (length / n) * (i + 0.14);
          box(mb, f, u, 0.02, u + w, h - 0.06, -0.04, -0.01, c, { top: false, back: true }, side);
        }
      } else {
        // Horizontal planks.
        const planks = 3;
        const pitch = (h - 0.1) / planks;
        for (let i = 0; i < planks; i++) {
          const v = 0.04 + i * pitch;
          box(
            mb,
            f,
            0,
            v,
            length,
            v + pitch * 0.75,
            -0.04,
            -0.01,
            c,
            { left: false, right: false, back: true },
            side,
          );
        }
      }
      return;
    }
  }
}

/**
 * Slab and railing of a balcony in front of one facade cell. A balcony shared by
 * several cells is drawn cell by cell; `span` says where it continues, so only its
 * outer ends get side railings.
 */
export function addBalcony(
  mb: MeshBuilder,
  f: Frame,
  b: ResolvedBalcony,
  span: CellBalcony,
  palette: Palette,
  era: number,
): void {
  const d = b.depth;
  const u0 = span.left ? 0 : INSET;
  const u1 = span.right ? f.width : f.width - INSET;
  const slab: Colour = b.railing === 'wood' ? shade(b.colour, 0.85) : shade(palette.trim, 0.9);
  box(mb, f, u0, -SLAB, u1, 0, 0, d, slab, { left: !span.left, right: !span.right }, shade(slab, 0.85));

  const t = 0.05;
  // Front run, in a frame standing at the slab edge.
  const front: Frame = { ...f, origin: at(f, u0, 0, d), width: u1 - u0 };
  railingRun(mb, front, u1 - u0, b, palette, era);
  // Side runs: their frames face sideways, u running from the wall out (left) or back in (right).
  const neg = (v: readonly [number, number, number]): [number, number, number] => [-v[0], -v[1], -v[2]];
  if (!span.left) {
    const side: Frame = {
      ...f,
      origin: at(f, u0, 0, 0),
      right: f.normal,
      normal: neg(f.right),
      width: d - t,
    };
    railingRun(mb, side, d - t, b, palette, era);
  }
  if (!span.right) {
    const side: Frame = {
      ...f,
      origin: at(f, u1, 0, d - t),
      right: neg(f.normal),
      normal: f.right,
      width: d - t,
    };
    railingRun(mb, side, d - t, b, palette, era);
  }
}
