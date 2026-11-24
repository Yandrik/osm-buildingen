import { shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at } from '../mesh/frame';
import type { FacadeOpening } from '../types';
import { wallRect } from './common';
import type { PieceContext } from './types';

/** Visible thickness of the wall above an arch: depth of the soffit behind the wall plane. */
export const ARCH_DEPTH = 0.3;
/** Tunnel surfaces are darker than the facade: they never see the sky. */
export const TUNNEL_WALL_SHADE = 0.8;
export const TUNNEL_CEILING_SHADE = 0.62;
/** The arch springs at this share of the clear height. */
const SPRING = 0.78;
const SEGMENT_LENGTH = 0.5;
const MAX_SEGMENTS = 6;
const TRIM_BAND = 0.22;
const TRIM_PROUD = 0.03;
/** Width of an arcade pier and of a colonnade column, where two bays meet. */
const PIER = 0.6;
const COLUMN = 0.36;
/** Narrower bays than this stay closed wall. */
const MIN_BAY = 0.9;
/** Arcade arches spring no lower than this share of the clear height (wide bays get flatter arches). */
const BAY_SPRING = 0.55;

/**
 * One facade cell of a passage (a road going through the building).
 *
 * Each opening is given in cell-local coordinates and may start before 0 or end
 * after the cell width when it spans several cells. Behind the wall plane lies the
 * real tunnel (pipeline/passages.ts): side walls along the corridor and a flat
 * ceiling at the clear height. This piece draws what belongs to the facade:
 *
 * - the wall beside and above the opening;
 * - for an arched opening a segmental top that reaches the clear height in the
 *   middle, with a trim band. The wall above the arch gets a thickness of
 *   `ARCH_DEPTH`: a soffit following the curve and, behind it, the lunette between
 *   the curve and the tunnel ceiling, facing into the tunnel. So the flat ceiling
 *   meets a closed surface and never the back of the facade;
 * - for a `flat` opening (party walls, where the tunnel continues into the next
 *   volume) just a rectangular hole up to the ceiling.
 *
 * Below the springing the tunnel walls are the jambs; nothing is drawn there.
 *
 * An arcade opening (`o.arcade`) is not one arch but one bay per cell: piers at the
 * cell edges where the arcade goes on (half in each cell), a full pier where it
 * reaches the end of the wall (a building corner, or the next house), and between
 * them a round arch (`arcade`) or a flat beam on slim columns (`colonnade`).
 */
export function arch(mb: MeshBuilder, f: Frame, ctx: PieceContext, openings: readonly FacadeOpening[]): void {
  const W = f.width;
  const H = f.height;
  const sorted = [...openings].sort((a, b) => a.from - b.from);
  /** The cell is finished up to here. */
  let done = 0;
  for (const o of sorted) {
    const u0 = Math.max(done, o.from);
    const u1 = Math.min(W, o.to);
    if (u1 - u0 < 1e-4) continue;
    wallRect(mb, f, ctx, done, 0, u0, H);
    if (o.arcade && !o.flat) bays(mb, f, ctx, o, u0, u1);
    else opening(mb, f, ctx, o, u0, u1);
    done = u1;
  }
  wallRect(mb, f, ctx, done, 0, W, H);
}

/** One arcade bay per cell between u0 and u1, with its piers. */
function bays(mb: MeshBuilder, f: Frame, ctx: PieceContext, o: FacadeOpening, u0: number, u1: number): void {
  const W = f.width;
  const H = f.height;
  const clear = Math.min(H, o.height);
  const colonnade = o.arcade === 'colonnade';
  const pier = colonnade ? COLUMN : PIER;
  const atStart = u0 < 1e-3;
  const atEnd = u1 > W - 1e-3;
  // Going on into the next cell: half a pier here. Reaching the end of the wall: a whole one.
  const left = atStart ? (o.endFrom ? pier : pier / 2) : 0;
  const right = atEnd ? (o.endTo ? pier : pier / 2) : 0;
  const a = u0 + left;
  const b = u1 - right;
  const inner = shade(ctx.wall, TUNNEL_WALL_SHADE);
  if (b - a < MIN_BAY) {
    // Too narrow to open: one wider pier, closed towards the walk behind it.
    const T = ARCH_DEPTH;
    wallRect(mb, f, ctx, u0, 0, u1, H);
    mb.quad(at(f, u1, 0, -T), at(f, u0, 0, -T), at(f, u0, clear, -T), at(f, u1, clear, -T), inner);
    mb.quad(at(f, u0, 0, -T), at(f, u0, 0, 0), at(f, u0, clear, 0), at(f, u0, clear, -T), inner);
    mb.quad(at(f, u1, 0, 0), at(f, u1, 0, -T), at(f, u1, clear, -T), at(f, u1, clear, 0), inner);
    return;
  }
  const soffit = shade(ctx.wall, TUNNEL_CEILING_SHADE);
  const T = ARCH_DEPTH;
  const half = (b - a) / 2;
  const spring = colonnade ? clear : Math.max(clear * BAY_SPRING, clear - half);

  if (left > 0) pierBlock(mb, f, ctx, u0, a, spring, clear, inner, 'right');
  if (right > 0) pierBlock(mb, f, ctx, b, u1, spring, clear, inner, 'left');

  if (!colonnade) {
    opening(
      mb,
      f,
      ctx,
      {
        ...o,
        from: a,
        to: b,
        endFrom: true,
        endTo: true,
        capFrom: o.capFrom && left === 0,
        capTo: o.capTo && right === 0,
      },
      a,
      b,
      spring,
    );
    return;
  }
  // Colonnade: wall above a straight beam at the ceiling, with a band along the beam.
  // The tunnel ceiling reaches the facade line, so it is also the underside of the beam.
  wallRect(mb, f, ctx, a, clear, b, H);
  const band = Math.min(TRIM_BAND, H - clear - 0.02);
  if (band > 0.03) {
    const v0 = clear;
    const v1 = clear + band;
    mb.quad(
      at(f, u0, v0, TRIM_PROUD),
      at(f, u1, v0, TRIM_PROUD),
      at(f, u1, v1, TRIM_PROUD),
      at(f, u0, v1, TRIM_PROUD),
      ctx.palette.trim,
    );
    mb.quad(at(f, u0, v0), at(f, u1, v0), at(f, u1, v0, TRIM_PROUD), at(f, u0, v0, TRIM_PROUD), soffit);
    mb.quad(
      at(f, u0, v1, TRIM_PROUD),
      at(f, u1, v1, TRIM_PROUD),
      at(f, u1, v1),
      at(f, u0, v1),
      ctx.palette.trim,
    );
  }
  if (o.capFrom && left === 0)
    mb.quad(at(f, a, clear, -T), at(f, a, clear, 0), at(f, a, H, 0), at(f, a, H, -T), inner);
  if (o.capTo && right === 0)
    mb.quad(at(f, b, clear, 0), at(f, b, clear, -T), at(f, b, H, -T), at(f, b, H, 0), inner);
}

/**
 * A pier (or column) from u0 to u1 standing in the facade plane, `ARCH_DEPTH` deep:
 * the front is wall up to the cell top, the face towards the bay goes up to where
 * the arch springs, the back faces the arcade walk up to its ceiling.
 */
function pierBlock(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  u0: number,
  u1: number,
  spring: number,
  clear: number,
  inner: ReturnType<typeof shade>,
  bay: 'left' | 'right',
): void {
  const T = ARCH_DEPTH;
  wallRect(mb, f, ctx, u0, 0, u1, f.height);
  if (bay === 'right')
    mb.quad(at(f, u1, 0, 0), at(f, u1, 0, -T), at(f, u1, spring, -T), at(f, u1, spring, 0), inner);
  else mb.quad(at(f, u0, 0, -T), at(f, u0, 0, 0), at(f, u0, spring, 0), at(f, u0, spring, -T), inner);
  mb.quad(at(f, u1, 0, -T), at(f, u0, 0, -T), at(f, u0, clear, -T), at(f, u1, clear, -T), inner);
}

/** The part of one opening between u0 and u1 (cell-local, inside the cell). */
function opening(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  o: FacadeOpening,
  u0: number,
  u1: number,
  springAt?: number,
): void {
  const H = f.height;
  const clear = Math.min(H, o.height);
  if (o.flat) {
    wallRect(mb, f, ctx, u0, clear, u1, H);
    return;
  }
  const centre = (o.from + o.to) / 2;
  const half = (o.to - o.from) / 2;
  const spring = springAt ?? clear * SPRING;
  const top = (u: number): number => {
    const x = Math.min(1, Math.abs(u - centre) / half);
    return spring + (clear - spring) * Math.sqrt(Math.max(0, 1 - x * x));
  };

  const soffit = shade(ctx.wall, TUNNEL_CEILING_SHADE);
  const inner = shade(ctx.wall, TUNNEL_WALL_SHADE);
  const T = ARCH_DEPTH;
  const n = Math.max(1, Math.min(MAX_SEGMENTS, Math.ceil((u1 - u0) / SEGMENT_LENGTH)));
  for (let i = 0; i < n; i++) {
    const a = u0 + ((u1 - u0) * i) / n;
    const b = u0 + ((u1 - u0) * (i + 1)) / n;
    const ha = top(a);
    const hb = top(b);
    // The wall starts at the curve; the trim band sits in front of it, so nothing shows through behind the band.
    mb.quad(at(f, a, ha), at(f, b, hb), at(f, b, H), at(f, a, H), ctx.wall);
    const band = Math.min(TRIM_BAND, H - Math.max(ha, hb) - 0.02);
    if (band > 0.03)
      mb.quad(
        at(f, a, ha, TRIM_PROUD),
        at(f, b, hb, TRIM_PROUD),
        at(f, b, hb + band, TRIM_PROUD),
        at(f, a, ha + band, TRIM_PROUD),
        ctx.palette.trim,
      );
    mb.quad(at(f, a, ha, -T), at(f, b, hb, -T), at(f, b, hb, 0), at(f, a, ha, 0), soffit);
    if (band > 0.03) {
      // Underside and top of the band, so it is a closed moulding from below and from above.
      mb.quad(at(f, a, ha), at(f, b, hb), at(f, b, hb, TRIM_PROUD), at(f, a, ha, TRIM_PROUD), soffit);
      mb.quad(
        at(f, a, ha + band, TRIM_PROUD),
        at(f, b, hb + band, TRIM_PROUD),
        at(f, b, hb + band),
        at(f, a, ha + band),
        ctx.palette.trim,
      );
    }
    // Lunette: closes the wall thickness towards the tunnel, up to its ceiling.
    // At the apex one side has no height left and the quad is a triangle.
    if (clear - ha < 1e-6) mb.tri(at(f, b, hb, -T), at(f, a, ha, -T), at(f, b, clear, -T), inner);
    else if (clear - hb < 1e-6) mb.tri(at(f, b, hb, -T), at(f, a, ha, -T), at(f, a, clear, -T), inner);
    else mb.quad(at(f, b, hb, -T), at(f, a, ha, -T), at(f, a, clear, -T), at(f, b, clear, -T), inner);
  }
  // End faces of the trim band.
  const bandAt = (u: number): number => Math.min(TRIM_BAND, H - top(u) - 0.02);
  if (o.endFrom && bandAt(u0) > 0.03) {
    const v = top(u0);
    const w = v + bandAt(u0);
    mb.quad(at(f, u0, v), at(f, u0, v, TRIM_PROUD), at(f, u0, w, TRIM_PROUD), at(f, u0, w), ctx.palette.trim);
  }
  if (o.endTo && bandAt(u1) > 0.03) {
    const v = top(u1);
    const w = v + bandAt(u1);
    mb.quad(at(f, u1, v, TRIM_PROUD), at(f, u1, v), at(f, u1, w), at(f, u1, w, TRIM_PROUD), ctx.palette.trim);
  }
  // End faces of the wall thickness, where the tunnel is open beside them.
  if (o.capFrom) {
    const v = top(u0);
    mb.quad(at(f, u0, v, -T), at(f, u0, v, 0), at(f, u0, clear, 0), at(f, u0, clear, -T), inner);
  }
  if (o.capTo) {
    const v = top(u1);
    mb.quad(at(f, u1, v, 0), at(f, u1, v, -T), at(f, u1, clear, -T), at(f, u1, clear, 0), inner);
  }
}
