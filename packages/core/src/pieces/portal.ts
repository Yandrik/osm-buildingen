import { type Colour, shade } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, at, box, rect } from '../mesh/frame';
import type { Vec3 } from '../types';
import { param } from './common';
import type { Piece, PieceContext } from './types';
import { archLine } from './window';

const ARCH_SEGMENTS = 6;
const ROUND_SEGMENTS = 12;
/** cos and sin for a twelfth of a turn at a time, rounded so every engine draws the same circle. */
const UNIT_CIRCLE: readonly (readonly [number, number])[] = Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
  const angle = (i / ROUND_SEGMENTS) * 2 * Math.PI;
  return [Math.round(Math.cos(angle) * 1e6) / 1e6, Math.round(Math.sin(angle) * 1e6) / 1e6] as const;
});

type Point = readonly [number, number];

/**
 * A round opening in a wall face: reveal ring, glass and bars. The caller leaves
 * the hole in the wall (see `circle`). With `spokes` (6 or 12) bars meet in a hub
 * (a rose window); with 0 the glass gets a plain cross (an oculus). A synagogue
 * gets a Star of David instead of either.
 */
function roundWindow(
  mb: MeshBuilder,
  f: Frame,
  ctx: PieceContext,
  cu: number,
  cv: number,
  r: number,
  spokes: number,
  proud: number,
): void {
  const depth = 0.14;
  const reveal = ctx.palette.frame;
  const ring = circle(cu, cv, r);
  const n = ring.length;
  // Clockwise seen from outside, so the reveal faces into the opening.
  for (let i = 0; i < n; i++) {
    const a = ring[(n - i) % n] as Point;
    const b = ring[(n - i - 1 + n) % n] as Point;
    mb.quad(
      at(f, a[0], a[1], proud),
      at(f, a[0], a[1], -depth),
      at(f, b[0], b[1], -depth),
      at(f, b[0], b[1], proud),
      reveal,
    );
  }
  mb.polygon(
    ring.map((p) => at(f, p[0], p[1], -depth)),
    ctx.palette.glass,
  );
  const bar = Math.max(0.05, r * 0.07);
  const d = -depth + 0.03;
  if (ctx.faith === 'jewish') {
    // Star of David: two triangles between corners of the ring.
    for (const first of [1, 3]) {
      for (let k = 0; k < 3; k++) {
        const p = ring[(first + 4 * k) % n] as Point;
        const q = ring[(first + 4 * (k + 1)) % n] as Point;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const t: Point = [(-(q[1] - p[1]) / l) * (bar / 2), ((q[0] - p[0]) / l) * (bar / 2)];
        mb.quad(
          at(f, p[0] - t[0], p[1] - t[1], d),
          at(f, q[0] - t[0], q[1] - t[1], d),
          at(f, q[0] + t[0], q[1] + t[1], d),
          at(f, p[0] + t[0], p[1] + t[1], d),
          reveal,
        );
      }
    }
    return;
  }
  // Bars run to corners of the ring: every corner, every second (rose), or every third (the cross of an oculus).
  const stride = spokes >= 12 ? 1 : spokes > 0 ? 2 : 3;
  for (let k = 0; k < ROUND_SEGMENTS; k += stride) {
    const e = UNIT_CIRCLE[k] as Point;
    const t: Point = [-e[1] * (bar / 2), e[0] * (bar / 2)];
    const r0 = r * 0.16;
    const r1 = r * 0.97;
    mb.quad(
      at(f, cu + e[0] * r0 - t[0], cv + e[1] * r0 - t[1], d),
      at(f, cu + e[0] * r1 - t[0], cv + e[1] * r1 - t[1], d),
      at(f, cu + e[0] * r1 + t[0], cv + e[1] * r1 + t[1], d),
      at(f, cu + e[0] * r0 + t[0], cv + e[1] * r0 + t[1], d),
      reveal,
    );
  }
  if (spokes > 0) {
    // Hub, and an inner ring where the spokes of a rose meet their foils.
    mb.polygon(
      circle(cu, cv, r * 0.22).map((p) => at(f, p[0], p[1], d + 0.01)),
      reveal,
    );
    const inner = circle(cu, cv, r * 0.58);
    const outer = circle(cu, cv, r * 0.58 + bar);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mb.quad(
        at(f, (inner[i] as Point)[0], (inner[i] as Point)[1], d),
        at(f, (outer[i] as Point)[0], (outer[i] as Point)[1], d),
        at(f, (outer[j] as Point)[0], (outer[j] as Point)[1], d),
        at(f, (inner[j] as Point)[0], (inner[j] as Point)[1], d),
        reveal,
      );
    }
  }
}

/** Twelve-sided ring around (cu, cv), counter-clockwise seen from outside. */
export function circle(cu: number, cv: number, r: number): Point[] {
  return UNIT_CIRCLE.map(([c, s]): Point => [cu + c * r, cv + s * r]);
}

/**
 * Raised ring between two radii on the wall plane (the moulding round a rose, the
 * rim of a clock). Front face only: it stands out too little to show its side.
 */
export function ringBand(
  mb: MeshBuilder,
  f: Frame,
  cu: number,
  cv: number,
  r0: number,
  r1: number,
  d: number,
  colour: Colour,
): void {
  const inner = circle(cu, cv, r0);
  const outer = circle(cu, cv, r1);
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.quad(
      at(f, (inner[i] as Point)[0], (inner[i] as Point)[1], d),
      at(f, (outer[i] as Point)[0], (outer[i] as Point)[1], d),
      at(f, (outer[j] as Point)[0], (outer[j] as Point)[1], d),
      at(f, (inner[j] as Point)[0], (inner[j] as Point)[1], d),
      colour,
    );
  }
}

/**
 * Church portal: a doorway whose reveals step inwards arch behind arch, a double
 * door with a tympanum over it, and a round window above when the cell is tall
 * enough to hold one.
 *
 * Params:
 *   w, h      clear width and height (to the crown) of the doorway in metres; both
 *             grow with the cell height, up to 1.6 times, so a cathedral gets a
 *             bigger door than a chapel
 *   arch      rise of the arch as a fraction of the width (0 = straight lintel,
 *             0.5 = round); pointed = 1 lets a taller rise come to a point
 *   steps     number of stepped reveals (orders) around the doorway; fewer in a narrow cell
 *   glass     1 = glazed doors and tympanum (modern)
 *   frame     1 = pilasters and an entablature around the doorway (classic)
 *   rose      radius of the round window above as a fraction of the cell width (0 = none)
 *   spokes    bars of that window (6 or 12); 0 makes it an oculus with a plain cross
 */
export const portal: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  const s = 0.24; // each order is this much wider and higher than the one inside it
  // As many orders as leave a doorway of 1.4 m in this cell.
  const steps = Math.max(0, Math.min(Math.round(param(ctx, 'steps', 2)), Math.floor((W - 1.9) / (2 * s))));
  const stepDepth = 0.2;
  const grow = Math.min(1.6, Math.max(1, H / 7));
  const ow = Math.max(0.9, Math.min(W - 2 * steps * s - 0.5, param(ctx, 'w', 2.2) * grow));
  // With a round window above, the doorway keeps to the lower half of the cell.
  const share = param(ctx, 'rose', 0) > 0 && H > 6 ? 0.5 : 1;
  const oh = Math.max(1.9, Math.min((H - steps * s - 0.6) * share, param(ctx, 'h', 3.6) * grow));
  const mid = W / 2;
  const pointed = param(ctx, 'pointed', 0) >= 1;
  const rise = Math.min(param(ctx, 'arch', 0.5) * ow, oh - 1.7);
  const arched = rise > 0.1;
  const spring = arched ? oh - rise : oh;
  // How much faster than sideways the crown of a pointed arch rises when the arch is offset.
  const lift = arched && pointed && rise > ow / 2 ? rise / (ow / 2) : 1;
  const base = ctx.plinth > 0 ? Math.min(ctx.plinth, spring - 0.2) : 0;

  /** Outline of the opening widened by `off`, left foot to right foot, over the top. */
  const outline = (off: number, foot: number): Point[] => {
    const u0 = mid - ow / 2 - off;
    const u1 = mid + ow / 2 + off;
    const points: Point[] = [[u0, foot]];
    if (arched) {
      const top = archLine(u0, u1, oh + off * lift, rise + off * lift, pointed);
      for (let i = 0; i <= ARCH_SEGMENTS; i++) {
        const u = u0 + ((u1 - u0) * i) / ARCH_SEGMENTS;
        points.push([u, i === 0 || i === ARCH_SEGMENTS ? spring : top(u)]);
      }
    } else {
      points.push([u0, oh + off], [u1, oh + off]);
    }
    points.push([u1, foot]);
    return points;
  };

  // --- Round window above the doorway ---
  const crown = oh + steps * s * lift;
  const wanted = param(ctx, 'rose', 0) * W;
  const room = (H - crown - 0.5) / 2 - 0.25;
  const r = Math.min(wanted, room, 3.2);
  const rose = wanted > 0 && r >= 0.55;
  const cu = mid;
  const cv = crown + (H - crown) / 2;

  // --- Wall around the outermost order, with the hole for the round window ---
  const outer = outline(steps * s, base);
  const wall: Vec3[] = [
    at(f, 0, base),
    ...outer.map((p) => at(f, p[0], p[1])),
    at(f, W, base),
    at(f, W, H),
    at(f, 0, H),
  ];
  mb.polygon(wall, ctx.wall, rose ? [circle(cu, cv, r).map((p) => at(f, p[0], p[1]))] : []);
  if (base > 0) {
    rect(mb, f, 0, 0, (outer[0] as Point)[0], base, ctx.palette.base);
    rect(mb, f, (outer[outer.length - 1] as Point)[0], 0, W, base, ctx.palette.base);
  }
  if (rose) {
    roundWindow(mb, f, ctx, cu, cv, r, Math.round(param(ctx, 'spokes', 0)), 0);
    ringBand(mb, f, cu, cv, r, r + Math.max(0.1, r * 0.1), 0.03, shade(ctx.wall, 0.9));
  }

  // --- Orders: each one a band going into the wall and a ledge facing out ---
  const stone = shade(ctx.wall, 0.93);
  const stoneDark = shade(ctx.wall, 0.8);
  for (let k = 0; k < steps; k++) {
    const d0 = -k * stepDepth;
    const d1 = -(k + 1) * stepDepth;
    const a = outline((steps - k) * s, 0);
    const b = outline((steps - k - 1) * s, 0);
    for (let i = 0; i + 1 < a.length; i++) {
      const p = a[i] as Point;
      const q = a[i + 1] as Point;
      mb.quad(
        at(f, p[0], p[1], d0),
        at(f, p[0], p[1], d1),
        at(f, q[0], q[1], d1),
        at(f, q[0], q[1], d0),
        stoneDark,
      );
      const pi = b[i] as Point;
      const qi = b[i + 1] as Point;
      mb.quad(
        at(f, p[0], p[1], d1),
        at(f, pi[0], pi[1], d1),
        at(f, qi[0], qi[1], d1),
        at(f, q[0], q[1], d1),
        stone,
      );
    }
  }

  // --- The doorway itself: reveal, doors, tympanum ---
  const back = -steps * stepDepth;
  const leafDepth = back - 0.16;
  const inner = outline(0, 0);
  for (let i = 0; i + 1 < inner.length; i++) {
    const p = inner[i] as Point;
    const q = inner[i + 1] as Point;
    mb.quad(
      at(f, p[0], p[1], back),
      at(f, p[0], p[1], leafDepth),
      at(f, q[0], q[1], leafDepth),
      at(f, q[0], q[1], back),
      stoneDark,
    );
  }
  const u0 = mid - ow / 2;
  const u1 = mid + ow / 2;
  const glazed = param(ctx, 'glass', 0) >= 1;
  const leaf = ctx.palette.door;
  rect(mb, f, u0, 0, u1, spring, leaf, leafDepth);
  if (arched) {
    // Tympanum: the field between the springing line and the arch.
    const field = inner.slice(1, -1);
    const ordered = [field[0] as Point, field[field.length - 1] as Point, ...field.slice(1, -1).reverse()];
    mb.polygon(
      ordered.map((p) => at(f, p[0], p[1], leafDepth)),
      glazed ? ctx.palette.glass : stone,
    );
    box(mb, f, u0, spring - 0.07, u1, spring + 0.07, leafDepth, leafDepth + 0.05, stoneDark, {
      left: false,
      right: false,
    });
  }
  const d = leafDepth + 0.012;
  const lw = ow / 2;
  for (let i = 0; i < 2; i++) {
    const a = u0 + i * lw;
    const m = Math.min(0.14, lw * 0.14);
    if (glazed) rect(mb, f, a + m, m, a + lw - m, spring - m, ctx.palette.glass, d);
    else {
      // Sunk panels and iron straps read as a heavy wooden door.
      const panel = shade(leaf, 0.86);
      rect(mb, f, a + m, spring * 0.56, a + lw - m, spring - m, panel, d);
      rect(mb, f, a + m, m, a + lw - m, spring * 0.5, panel, d);
    }
  }
  // The meeting stile between the two leaves.
  rect(mb, f, mid - 0.03, 0, mid + 0.03, spring, shade(leaf, 0.7), d + 0.005);

  // --- Steps in front, and the classic frame ---
  const reach = ow / 2 + steps * s;
  box(mb, f, mid - reach - 0.25, 0, mid + reach + 0.25, 0.14, 0, 0.5, shade(ctx.palette.base, 0.95));
  if (param(ctx, 'frame', 0) >= 1) {
    const trim = ctx.palette.trim;
    const side = shade(trim, 0.85);
    const pw = Math.min(0.42, ow * 0.16);
    const top = oh + steps * s + 0.12;
    if (mid - reach - pw > 0.05 && top + 0.5 < (rose ? cv - r - 0.15 : H - 0.1)) {
      box(mb, f, mid - reach - pw, 0.14, mid - reach, top, 0, 0.1, trim, { bottom: false }, side);
      box(mb, f, mid + reach, 0.14, mid + reach + pw, top, 0, 0.1, trim, { bottom: false }, side);
      box(mb, f, mid - reach - pw - 0.1, top, mid + reach + pw + 0.1, top + 0.34, 0, 0.18, trim, {}, side);
    }
  }
};

/**
 * Clock face in the middle of a blank cell: rim, face, hands and the four quarter marks.
 * Params: r = radius as a fraction of the smaller cell side (default 0.36).
 */
export const clock: Piece = (mb, f, ctx) => {
  const W = f.width;
  const H = f.height;
  rect(mb, f, 0, 0, W, H, ctx.wall);
  const r = Math.min(Math.min(W, H) * param(ctx, 'r', 0.36), 2.4);
  if (r < 0.35) return;
  const cu = W / 2;
  const cv = H / 2;
  const rim = 0x2e2e30;
  const gold = 0xc9a227;
  const dark = ctx.era > 0.5;
  mb.polygon(
    circle(cu, cv, r).map((p) => at(f, p[0], p[1], 0.05)),
    dark ? 0x34373b : 0xefe9d8,
  );
  // The disc's edge, so it does not float in front of the wall.
  const edge = circle(cu, cv, r);
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i] as Point;
    const b = edge[(i + 1) % edge.length] as Point;
    mb.quad(
      at(f, a[0], a[1], 0),
      at(f, b[0], b[1], 0),
      at(f, b[0], b[1], 0.05),
      at(f, a[0], a[1], 0.05),
      rim,
    );
  }
  ringBand(mb, f, cu, cv, r * 0.88, r, 0.06, dark ? 0xd8d8d2 : rim);
  const ink = dark ? 0xefe9d8 : gold;
  const hand = dark ? 0xefe9d8 : rim;
  /** Bar from the centre outwards in direction (x, y), counter-clockwise seen from outside. */
  const bar = (x: number, y: number, r0: number, r1: number, half: number, colour: Colour): void => {
    const t: Point = [-y * half, x * half];
    mb.quad(
      at(f, cu + x * r0 - t[0], cv + y * r0 - t[1], 0.07),
      at(f, cu + x * r1 - t[0], cv + y * r1 - t[1], 0.07),
      at(f, cu + x * r1 + t[0], cv + y * r1 + t[1], 0.07),
      at(f, cu + x * r0 + t[0], cv + y * r0 + t[1], 0.07),
      colour,
    );
  };
  for (const [x, y] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const)
    bar(x, y, r * 0.68, r * 0.84, r * 0.045, ink);
  // Ten past ten, as on every clock in a shop window.
  bar(-0.5, 0.866, -r * 0.08, r * 0.46, r * 0.045, hand);
  bar(0.866, 0.5, -r * 0.08, r * 0.7, r * 0.03, hand);
};
