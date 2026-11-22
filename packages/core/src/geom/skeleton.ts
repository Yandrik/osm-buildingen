import { type Ring, pointInRing, signedArea } from './polygon';
import { type Vec2, pointSegment } from './vec2';

/**
 * Straight skeleton of a simple polygon, by wavefront propagation.
 *
 * Every edge moves inward at its own speed (1 by default). The wavefront is a set
 * of rings of moving vertices; two kinds of events change it:
 *  - edge event: a wavefront edge shrinks to zero length, its two vertices merge;
 *  - split event: a reflex vertex runs into another wavefront edge and splits it
 *    (or, with holes, joins two rings).
 * An edge can be told to wait (`delay`): it stands still at first, which makes its
 * face a vertical wall, a gable end.
 * After every event all upcoming events are recomputed from scratch. That is
 * O(n³) overall but footprints are small, and it keeps the code free of stale
 * event queues, which is where most skeleton implementations go wrong.
 *
 * Building footprints are full of exact degeneracies (parallel walls, equal wing
 * widths), so several events usually happen at once. They are handled one at a
 * time: each step leaves a topologically valid wavefront, possibly with
 * zero-length edges, and those collapse in the following steps. Two parallel
 * edges that meet along their length leave a vertex with no finite speed; it is
 * resolved at once by walking along the shorter of the two edges (a ridge).
 *
 * The result is checked before it is returned (faces closed, counter-clockwise,
 * simple, planar, tiling the polygon). If the check fails, the run is repeated on
 * a slightly perturbed copy of the input, and if that fails too the function
 * returns null. It never throws.
 */

export interface SkeletonNode {
  p: Vec2;
  /** Time at which the wavefront reached the node: the inward offset distance for edges without delay. */
  time: number;
}

export interface SkeletonFace {
  /** 0 = outer ring, 1.. = holes. */
  ring: number;
  /** Edge `ring[edge] -> ring[edge + 1]`. */
  edge: number;
  /**
   * Indices into `Skeleton.nodes`, counter-clockwise; the first two are the ends of
   * the edge. Empty for an input edge shorter than 0.01 mm (it has no face).
   */
  nodes: number[];
  points: Vec2[];
  /** Offset distance at each point; multiply with the slope to get a roof height. */
  times: number[];
}

export interface Skeleton {
  nodes: SkeletonNode[];
  /** One per input edge: outer ring first, then the holes, in input order. */
  faces: SkeletonFace[];
  maxTime: number;
  /** 0 when the input was used as is, otherwise the number of the perturbed retry that succeeded. */
  attempt: number;
}

export interface SkeletonOptions {
  /**
   * Per edge (outer ring first, then holes): the time at which the edge starts to
   * move, 0 by default. Until then it stays where it is and its face is vertical.
   * Infinity gives a gable end, a finite value a gable with its tip hipped off.
   * A waiting edge must not have a neighbour parallel to it.
   */
  delay?: readonly number[];
}

/** Input points closer than this are merged. */
const MIN_EDGE = 1e-5;
/** Sine of the angle below which two edges count as parallel. */
const PARALLEL = 1e-8;
/** How far back (in units of the tolerance) a missed split event is still picked up. */
const BACK = 16;
/** Events closer in time than this fraction of the tolerance count as simultaneous. */
const TIE = 1e-4;
/** A zero-length edge survives only if its ends separate faster than this. */
const GROW = 1e-4;
/** [perturbation in metres, tolerance factor] per attempt. */
const ATTEMPTS: readonly (readonly [number, number])[] = [
  [0, 1e-8],
  [0, 1e-6],
  [2e-5, 1e-8],
  [1e-4, 1e-8],
];

interface Line {
  px: number;
  py: number;
  dx: number;
  dy: number;
  /** Inward normal. */
  nx: number;
  ny: number;
  w: number;
}

interface Motion {
  vx: number;
  vy: number;
  /** The two edges are antiparallel: the vertex has no finite speed. */
  inf: boolean;
  reflex: boolean;
}

/** Wavefront vertex between the edges `a` (arriving) and `b` (leaving). */
class Wv {
  prev: Wv = this;
  next: Wv = this;
  alive = true;
  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly t0: number,
    readonly m: Motion,
    readonly a: number,
    readonly b: number,
    /** Skeleton node the vertex started from. */
    readonly node: number,
  ) {}
}

interface RawNode {
  x: number;
  y: number;
  t: number;
}

/** Skeleton arc between two nodes; it separates the faces of the edges `f1` and `f2`. */
interface Arc {
  from: number;
  to: number;
  f1: number;
  f2: number;
}

interface Raw {
  nodes: RawNode[];
  arcs: Arc[];
}

/** Velocity of the wavefront vertex between two edges, or null if there is none. */
function motion(a: Line, b: Line): Motion | null {
  const cr = a.dx * b.dy - a.dy * b.dx;
  const dt = a.dx * b.dx + a.dy * b.dy;
  if (dt > 0 && a.w === b.w) {
    // Well conditioned down to collinear edges, where the vertex moves straight inward.
    const s = a.w / (1 + dt);
    return { vx: (a.nx + b.nx) * s, vy: (a.ny + b.ny) * s, inf: false, reflex: cr < -1e-9 };
  }
  if (Math.abs(cr) < PARALLEL) {
    // Antiparallel edges that touch enclose nothing. Parallel edges of different speed
    // would need a new edge between them, which this implementation does not create.
    if (dt < 0 && a.w + b.w > 0) return { vx: 0, vy: 0, inf: true, reflex: false };
    return null;
  }
  return {
    vx: (a.w * b.dx - b.w * a.dx) / cr,
    vy: (a.w * b.dy - b.w * a.dy) / cr,
    inf: false,
    reflex: cr < 0,
  };
}

function propagate(rings: readonly (readonly Vec2[])[], delay: readonly number[], eps: number): Raw | null {
  const lines: Line[] = [];
  const nodes: RawNode[] = [];
  const arcs: Arc[] = [];
  let verts: Wv[] = [];
  let failed = false;
  let time = 0;

  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i] as Vec2;
      const q = ring[(i + 1) % n] as Vec2;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (!(len > 1e-9)) return null;
      const dx = (q[0] - p[0]) / len;
      const dy = (q[1] - p[1]) / len;
      lines.push({ px: p[0], py: p[1], dx, dy, nx: -dy, ny: dx, w: (delay[lines.length] ?? 0) > 0 ? 0 : 1 });
    }
  }
  let base = 0;
  for (const ring of rings) {
    const n = ring.length;
    const first = verts.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i] as Vec2;
      const a = base + ((i + n - 1) % n);
      const b = base + i;
      const m = motion(lines[a] as Line, lines[b] as Line);
      if (!m || m.inf) return null;
      nodes.push({ x: p[0], y: p[1], t: 0 });
      verts.push(new Wv(p[0], p[1], 0, m, a, b, base + i));
    }
    for (let i = 0; i < n; i++) {
      const v = verts[first + i] as Wv;
      v.next = verts[first + ((i + 1) % n)] as Wv;
      v.prev = verts[first + ((i + n - 1) % n)] as Wv;
    }
    base += n;
  }

  const posX = (v: Wv, t: number): number => (v.m.inf ? v.ox : v.ox + v.m.vx * (t - v.t0));
  const posY = (v: Wv, t: number): number => (v.m.inf ? v.oy : v.oy + v.m.vy * (t - v.t0));
  const addNode = (x: number, y: number, t: number): number => nodes.push({ x, y, t }) - 1;
  const addArc = (from: number, to: number, f1: number, f2: number): void => {
    arcs.push({ from, to, f1, f2 });
  };
  const link = (u: Wv, v: Wv): void => {
    u.next = v;
    v.prev = u;
  };
  const spawn = (x: number, y: number, a: number, b: number, node: number): Wv => {
    let m = motion(lines[a] as Line, lines[b] as Line);
    if (!m) {
      failed = true;
      m = { vx: 0, vy: 0, inf: false, reflex: false };
    }
    // Events are found with a tolerance, so (x, y) is only near the two wavefront
    // lines. Starting the vertex exactly on them keeps such errors from adding up
    // from event to event, which matters once a fast vertex multiplies them.
    const la = lines[a] as Line;
    const lb = lines[b] as Line;
    const ca = la.nx * la.px + la.ny * la.py + la.w * time;
    const cb = lb.nx * lb.px + lb.ny * lb.py + lb.w * time;
    const cr = la.dx * lb.dy - la.dy * lb.dx;
    if (Math.abs(cr) > 0.05) {
      x = (ca * lb.dx - cb * la.dx) / cr;
      y = (ca * lb.dy - cb * la.dy) / cr;
    } else {
      // (Anti)parallel: the crossing point is badly conditioned, only move onto the lines.
      const ra = (la.nx * x + la.ny * y - ca) / 2;
      const rb = (lb.nx * x + lb.ny * y - cb) / 2;
      x -= la.nx * ra + lb.nx * rb;
      y -= la.ny * ra + lb.ny * rb;
    }
    const v = new Wv(x, y, time, m, a, b, node);
    verts.push(v);
    return v;
  };

  /** A ring of one or two vertices encloses nothing: it ends in a ridge between the two. */
  const closeRing = (u: Wv): void => {
    const w = u.next;
    const nu = addNode(posX(u, time), posY(u, time), time);
    addArc(u.node, nu, u.a, u.b);
    u.alive = false;
    if (w === u) return;
    const nw = addNode(posX(w, time), posY(w, time), time);
    addArc(w.node, nw, w.a, w.b);
    addArc(nu, nw, u.b, w.b);
    w.alive = false;
  };

  /**
   * A vertex between two antiparallel edges: the strip between them has closed. The
   * shorter of the two edges is used up, which leaves a ridge along it.
   */
  const collapseStrip = (v: Wv): void => {
    const ua = v.prev;
    const ub = v.next;
    const la = lines[v.a] as Line;
    const lb = lines[v.b] as Line;
    const ax = posX(ua, time);
    const ay = posY(ua, time);
    const bx = posX(ub, time);
    const by = posY(ub, time);
    const lenA = (v.ox - ax) * la.dx + (v.oy - ay) * la.dy;
    const lenB = (bx - v.ox) * lb.dx + (by - v.oy) * lb.dy;
    if (lenA <= lenB) {
      const node = addNode(ax, ay, time);
      addArc(v.node, node, v.a, v.b);
      addArc(ua.node, node, ua.a, ua.b);
      const before = ua.prev;
      const w = spawn(ax, ay, ua.a, v.b, node);
      link(before, w);
      link(w, ub);
      ua.alive = false;
    } else {
      const node = addNode(bx, by, time);
      addArc(v.node, node, v.a, v.b);
      addArc(ub.node, node, ub.a, ub.b);
      const after = ub.next;
      const w = spawn(bx, by, v.a, ub.b, node);
      link(ua, w);
      link(w, after);
      ub.alive = false;
    }
    v.alive = false;
  };

  const edgeEvent = (u: Wv): void => {
    const w = u.next;
    // A vertex between nearly antiparallel edges is fast and its position along the
    // ridge is badly conditioned, so the slower vertex decides where the node is.
    const su = u.m.vx * u.m.vx + u.m.vy * u.m.vy;
    const sw = w.m.vx * w.m.vx + w.m.vy * w.m.vy;
    const k = su + sw > 1e-18 ? sw / (su + sw) : 0.5;
    const x = posX(u, time) * k + posX(w, time) * (1 - k);
    const y = posY(u, time) * k + posY(w, time) * (1 - k);
    const node = addNode(x, y, time);
    addArc(u.node, node, u.a, u.b);
    addArc(w.node, node, w.a, w.b);
    const before = u.prev;
    const after = w.next;
    const v = spawn(x, y, u.a, w.b, node);
    link(before, v);
    link(v, after);
    u.alive = false;
    w.alive = false;
  };

  /** Reflex vertex `r` hits the wavefront edge that starts at `s`. */
  const splitEvent = (r: Wv, s: Wv): void => {
    const e = s.b;
    const end = s.next;
    const x = posX(r, time);
    const y = posY(r, time);
    const node = addNode(x, y, time);
    addArc(r.node, node, r.a, r.b);
    const before = r.prev;
    const after = r.next;
    const left = spawn(x, y, r.a, e, node);
    const right = spawn(x, y, e, r.b, node);
    link(before, left);
    link(left, end);
    link(s, right);
    link(right, after);
    r.alive = false;
  };

  /**
   * Reflex vertex `r` runs into the vertex `c`. The ring is pinched there: what
   * came before `r` continues after `c` and the other way round.
   */
  const meetEvent = (r: Wv, c: Wv): void => {
    // Neighbours meeting is the edge between them collapsing.
    if (c.next === r || r.next === c) {
      edgeEvent(c.next === r ? c : r);
      return;
    }
    const x = (posX(r, time) + posX(c, time)) / 2;
    const y = (posY(r, time) + posY(c, time)) / 2;
    const node = addNode(x, y, time);
    addArc(r.node, node, r.a, r.b);
    addArc(c.node, node, c.a, c.b);
    const beforeR = r.prev;
    const afterR = r.next;
    const beforeC = c.prev;
    const afterC = c.next;
    const first = spawn(x, y, r.a, c.b, node);
    const second = spawn(x, y, c.a, r.b, node);
    link(beforeR, first);
    link(first, afterC);
    link(beforeC, second);
    link(second, afterR);
    r.alive = false;
    c.alive = false;
  };

  /** A waiting edge starts to move: the vertices at its ends change direction. */
  const startEdge = (e: number): void => {
    const l = lines[e] as Line;
    // From now on the line is where it would be had it started `time` further out.
    l.px -= l.nx * time;
    l.py -= l.ny * time;
    l.w = 1;
    for (const v of verts.slice()) {
      if (!v.alive || (v.a !== e && v.b !== e)) continue;
      const x = posX(v, time);
      const y = posY(v, time);
      const node = addNode(x, y, time);
      addArc(v.node, node, v.a, v.b);
      const before = v.prev;
      const after = v.next;
      const w = spawn(x, y, v.a, v.b, node);
      link(before, w);
      link(w, after);
      v.alive = false;
    }
  };
  const waiting: number[] = [];
  for (let e = 0; e < lines.length; e++) {
    const d = delay[e] ?? 0;
    if (d > 0 && Number.isFinite(d)) waiting.push(e);
  }
  waiting.sort((p, q) => (delay[p] as number) - (delay[q] as number) || p - q);

  const limit = 12 * lines.length + 64;
  for (let iter = 0; ; iter++) {
    verts = verts.filter((v) => v.alive);
    if (verts.length === 0) break;
    if (failed || iter > limit) return null;

    let closed = false;
    for (const u of verts) {
      if (u.alive && u.next.next === u) {
        closeRing(u);
        closed = true;
      }
    }
    if (closed) continue;

    const strip = verts.find((v) => v.m.inf);
    if (strip) {
      collapseStrip(strip);
      continue;
    }

    // --- Next edge event ---
    let edgeTime = Number.POSITIVE_INFINITY;
    let edgeAt: Wv | null = null;
    for (const u of verts) {
      const w = u.next;
      const l = lines[u.b] as Line;
      const len = (posX(w, time) - posX(u, time)) * l.dx + (posY(w, time) - posY(u, time)) * l.dy;
      const rate = (w.m.vx - u.m.vx) * l.dx + (w.m.vy - u.m.vy) * l.dy;
      let t: number;
      if (len <= eps) {
        // Zero length already. It only stays if it clearly grows.
        if (rate > GROW && len >= -eps) continue;
        t = time;
      } else {
        if (rate > -1e-12) continue;
        t = time + len / -rate;
      }
      if (t < edgeTime) {
        edgeTime = t;
        edgeAt = u;
      }
    }

    // --- Next split event ---
    let splitTime = Number.POSITIVE_INFINITY;
    let splitVertex: Wv | null = null;
    let splitSegment: Wv | null = null;
    /** -1 / 1: the hit is on the vertex at the start / end of the segment. */
    let splitAt = 0;
    for (const r of verts) {
      if (!r.m.reflex) continue;
      const rx = posX(r, time);
      const ry = posY(r, time);
      let bestTime = Number.POSITIVE_INFINITY;
      let bestRank = -1;
      let bestAt = 0;
      let best: Wv | null = null;
      for (const s of verts) {
        const end = s.next;
        if (s === r || end === r) continue;
        const l = lines[s.b] as Line;
        const rate = l.nx * r.m.vx + l.ny * r.m.vy - l.w;
        if (rate > -1e-9) continue; // not approaching the edge
        const gap = l.nx * (rx - l.px) + l.ny * (ry - l.py) - l.w * time;
        // A vertex that went through the edge a moment ago is an event that was missed
        // because another one at (nearly) the same time came first. It still has to happen.
        if (gap < BACK * eps * rate) continue;
        const t = time + Math.max(0, gap) / -rate;
        if (t > bestTime + eps || t > splitTime + eps || t > edgeTime + eps) continue;
        const x = posX(r, t);
        const y = posY(r, t);
        const fromStart = (x - posX(s, t)) * l.dx + (y - posY(s, t)) * l.dy;
        const toEnd = (posX(end, t) - x) * l.dx + (posY(end, t) - y) * l.dy;
        const slack = gap < 0 ? BACK * eps : eps;
        if (fromStart < -slack || toEnd < -slack) continue;
        // A hit on the end of an edge is a hit on the vertex there, and so on the
        // neighbouring edge as well. The edge to split is the one whose cut-off piece
        // clearly grows; if neither does, the two vertices simply meet (rank 0).
        let rank = 2;
        let at = 0;
        if (toEnd <= 2 * eps) {
          // Two vertices that have just come out of the same event sit on top of each
          // other. Letting them meet again would undo that event.
          if (end.node === r.node && time - r.t0 <= eps) continue;
          const m = motion(lines[r.a] as Line, l);
          const grows = m && !m.inf && (end.m.vx - m.vx) * l.dx + (end.m.vy - m.vy) * l.dy > GROW;
          rank = grows ? 1 : 0;
          at = grows ? 0 : 1;
        } else if (fromStart <= 2 * eps) {
          if (s.node === r.node && time - r.t0 <= eps) continue;
          const m = motion(l, lines[r.b] as Line);
          const grows = m && !m.inf && (m.vx - s.m.vx) * l.dx + (m.vy - s.m.vy) * l.dy > GROW;
          rank = grows ? 1 : 0;
          at = grows ? 0 : -1;
        }
        if (t < bestTime - eps || (t <= bestTime + eps && rank > bestRank)) {
          bestTime = t;
          bestRank = rank;
          best = s;
          bestAt = at;
        }
      }
      if (best && bestTime < splitTime) {
        splitTime = bestTime;
        splitVertex = r;
        splitSegment = best;
        splitAt = bestAt;
      }
    }

    const starting = waiting[0];
    if (starting !== undefined && (delay[starting] as number) <= Math.min(edgeTime, splitTime)) {
      time = Math.max(time, delay[starting] as number);
      waiting.shift();
      startEdge(starting);
      continue;
    }

    // Strictly by time. Only a real tie goes to the edge event, which is the simpler one.
    if (edgeAt && edgeTime <= splitTime + TIE * eps) {
      time = Math.max(time, edgeTime);
      edgeEvent(edgeAt);
    } else if (splitVertex && splitSegment) {
      time = Math.max(time, splitTime);
      if (splitAt === 0) splitEvent(splitVertex, splitSegment);
      else meetEvent(splitVertex, splitAt > 0 ? splitSegment.next : splitSegment);
    } else {
      return null; // the wavefront is not empty but nothing is going to happen
    }
  }
  return failed ? null : { nodes, arcs };
}

interface Prepared {
  /** Cleaned rings, original coordinates. */
  rings: Vec2[][];
  /** Per ring and cleaned edge: index of the input edge it stands for. */
  edgeOf: number[][];
  inputEdges: number[];
  center: Vec2;
  scale: number;
  area: number;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** True if the open segments cross in a single interior point. */
function properCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol: number): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  );
}

function prepare(outer: Ring, holes: readonly Ring[]): Prepared | null {
  const input = [outer, ...holes];
  const rings: Vec2[][] = [];
  const edgeOf: number[][] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of input) {
    const n = ring.length;
    const kept: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = ring[i] as Vec2;
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
      const last = kept.length > 0 ? (ring[kept[kept.length - 1] as number] as Vec2) : null;
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > MIN_EDGE) kept.push(i);
    }
    while (kept.length > 1) {
      const a = ring[kept[0] as number] as Vec2;
      const b = ring[kept[kept.length - 1] as number] as Vec2;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > MIN_EDGE) break;
      kept.pop();
    }
    if (kept.length < 3) return null;
    const pts = kept.map((i): Vec2 => ring[i] as Vec2);
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    rings.push(pts);
    // Points dropped after a kept one were duplicates of it, so the real edge is the last one before the next kept point.
    edgeOf.push(kept.map((_, j) => ((kept[(j + 1) % kept.length] as number) + n - 1) % n));
  }
  const first = rings[0] as Vec2[];
  let area = signedArea(first);
  if (!(area > 1e-9)) return null;
  for (let h = 1; h < rings.length; h++) {
    const a = signedArea(rings[h] as Vec2[]);
    if (!(a < -1e-9)) return null;
    area += a;
    if (!pointInRing((rings[h] as Vec2[])[0] as Vec2, first)) return null;
  }
  if (!(area > 1e-9)) return null;
  const scale = Math.max(1, Math.hypot(maxX - minX, maxY - minY) / 2);

  // The input has to be simple.
  const segs: [Vec2, Vec2][] = [];
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) segs.push([ring[i] as Vec2, ring[(i + 1) % ring.length] as Vec2]);
  const tol = 1e-9 * scale * scale;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i] as [Vec2, Vec2];
      const u = segs[j] as [Vec2, Vec2];
      if (properCrossing(s[0], s[1], u[0], u[1], tol)) return null;
    }
  }
  return {
    rings,
    edgeOf,
    inputEdges: input.map((r) => r.length),
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
    scale,
    area,
  };
}

/** Turns arcs into one closed polygon per edge and checks the result. */
function assemble(prep: Prepared, delay: readonly number[], raw: Raw, attempt: number): Skeleton | null {
  const { rings, scale } = prep;
  const jitter = (ATTEMPTS[attempt] as readonly [number, number])[0];
  const tol = 1e-6 * scale + 4 * jitter;
  /** How far a face point may be off the plane of its face. */
  const planeTol = 2e-5 * scale + 5 * jitter;
  const count = raw.nodes.length;

  // Nodes joined by a (nearly) zero-length arc are one node. Simultaneous events produce these.
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const next = parent[i] as number;
      parent[i] = r;
      i = next;
    }
    return r;
  };
  let baseCount = 0;
  for (const ring of rings) baseCount += ring.length;
  for (const arc of raw.arcs) {
    const a = raw.nodes[arc.from] as RawNode;
    const b = raw.nodes[arc.to] as RawNode;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.t - b.t) > tol) continue;
    const ra = find(arc.from);
    const rb = find(arc.to);
    if (ra === rb) continue;
    // The lower index wins, so a footprint corner (they come first) keeps its exact position.
    if (ra < baseCount && rb < baseCount) continue;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  }
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const sumT = new Float64Array(count);
  const members = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const r = find(i);
    const node = raw.nodes[i] as RawNode;
    sumX[r] = (sumX[r] as number) + node.x;
    sumY[r] = (sumY[r] as number) + node.y;
    sumT[r] = (sumT[r] as number) + node.t;
    members[r] = (members[r] as number) + 1;
  }

  const nodes: SkeletonNode[] = [];
  const nodeIndex = new Int32Array(count).fill(-1);
  const flat: Vec2[] = rings.flat();
  const nodeOf = (rawIndex: number): number => {
    const r = find(rawIndex);
    let index = nodeIndex[r] as number;
    if (index < 0) {
      index = nodes.length;
      nodeIndex[r] = index;
      if (r < baseCount) nodes.push({ p: flat[r] as Vec2, time: 0 });
      else {
        const m = members[r] as number;
        nodes.push({
          p: [(sumX[r] as number) / m + prep.center[0], (sumY[r] as number) / m + prep.center[1]],
          time: Math.max(0, (sumT[r] as number) / m),
        });
      }
    }
    return index;
  };
  for (let i = 0; i < baseCount; i++) nodeOf(i);

  const arcsOf: number[][] = Array.from({ length: baseCount }, () => []);
  raw.arcs.forEach((arc, i) => {
    if (arc.f1 === arc.f2) return;
    (arcsOf[arc.f1] as number[]).push(i);
    (arcsOf[arc.f2] as number[]).push(i);
  });

  const faces: SkeletonFace[] = [];
  for (let r = 0; r < prep.inputEdges.length; r++) {
    for (let e = 0; e < (prep.inputEdges[r] as number); e++)
      faces.push({ ring: r, edge: e, nodes: [], points: [], times: [] });
  }
  let faceBase = 0;
  const faceOffsets: number[] = [];
  for (const n of prep.inputEdges) {
    faceOffsets.push(faceBase);
    faceBase += n;
  }

  let areaSum = 0;
  let maxTime = 0;
  let lineIndex = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r] as Vec2[];
    const n = ring.length;
    const ringBase = lineIndex;
    for (let i = 0; i < n; i++, lineIndex++) {
      const start = ringBase + i;
      const end = ringBase + ((i + 1) % n);
      const mine = arcsOf[lineIndex] as number[];
      const used = new Set<number>();
      const chain = [start, end];
      let cur = end;
      while (cur !== start) {
        let next = -1;
        for (const ai of mine) {
          if (used.has(ai)) continue;
          const arc = raw.arcs[ai] as Arc;
          if (arc.from === cur) next = arc.to;
          else if (arc.to === cur) next = arc.from;
          else continue;
          used.add(ai);
          break;
        }
        if (next < 0) return null; // the face is not closed
        cur = next;
        if (cur !== start) chain.push(cur);
      }
      if (used.size !== mine.length) return null; // arcs left over: a second, detached part

      const ids: number[] = [];
      for (const c of chain) {
        const id = nodeOf(c);
        if (ids[ids.length - 1] !== id) ids.push(id);
      }
      while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % n] as Vec2;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ids.length < 3) {
        // Only an edge about as short as the tolerance may lose its face to node merging.
        if (len > 100 * tol) return null;
        continue;
      }
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      const wait = delay[lineIndex] ?? 0;
      const points = ids.map((id) => (nodes[id] as SkeletonNode).p);
      const times = ids.map((id) => (nodes[id] as SkeletonNode).time);
      for (let k = 0; k < points.length; k++) {
        const p = points[k] as Vec2;
        const t = times[k] as number;
        // Every point of a face lies on the plane that rises from its edge (once the edge moves).
        if (Math.abs(nx * (p[0] - a[0]) + ny * (p[1] - a[1]) - Math.max(0, t - wait)) > planeTol) return null;
        if (t > maxTime) maxTime = t;
      }
      const area = signedArea(points);
      if (area < -tol * scale) return null;
      areaSum += area;
      const m = points.length;
      const crossTol = 1e-9 * scale * scale;
      for (let p = 0; p < m; p++) {
        for (let q = p + 2; q < m; q++) {
          if (p === 0 && q === m - 1) continue;
          if (
            properCrossing(
              points[p] as Vec2,
              points[(p + 1) % m] as Vec2,
              points[q] as Vec2,
              points[(q + 1) % m] as Vec2,
              crossTol,
            )
          )
            return null;
        }
      }
      const face = faces[(faceOffsets[r] as number) + ((prep.edgeOf[r] as number[])[i] as number)];
      if (!face) return null;
      face.nodes = ids;
      face.points = points;
      face.times = times;
    }
  }
  if (Math.abs(areaSum - prep.area) > 1e-4 * prep.area + tol * scale) return null;

  // Nodes must not leave the polygon.
  const outerRing = rings[0] as Vec2[];
  for (let i = baseCount; i < nodes.length; i++) {
    const p = (nodes[i] as SkeletonNode).p;
    let inside = pointInRing(p, outerRing);
    for (let h = 1; inside && h < rings.length; h++) if (pointInRing(p, rings[h] as Vec2[])) inside = false;
    if (inside) continue;
    let near = false;
    for (const ring of rings) {
      for (let k = 0; k < ring.length && !near; k++) {
        if (pointSegment(p, ring[k] as Vec2, ring[(k + 1) % ring.length] as Vec2).distance < 20 * tol)
          near = true;
      }
    }
    if (!near) return null;
  }
  return { nodes, faces, maxTime, attempt };
}

/**
 * Straight skeleton of a polygon. `outer` is counter-clockwise, `holes` are
 * clockwise, all rings open, coordinates in metres.
 *
 * Returns one face per input edge, or null if the input is not a simple polygon
 * or the result did not pass its checks.
 */
export function straightSkeleton(
  outer: Ring,
  holes: readonly Ring[] = [],
  options: SkeletonOptions = {},
): Skeleton | null {
  try {
    const prep = prepare(outer, holes);
    if (!prep) return null;
    // Delays are given per input edge; the wavefront runs on the cleaned rings.
    const delay: number[] = [];
    let offset = 0;
    for (let r = 0; r < prep.rings.length; r++) {
      for (const e of prep.edgeOf[r] as number[]) {
        const d = options.delay?.[offset + e] ?? 0;
        if (!(d >= 0)) return null;
        delay.push(d);
      }
      offset += prep.inputEdges[r] as number;
    }

    for (let attempt = 0; attempt < ATTEMPTS.length; attempt++) {
      const [jitter, factor] = ATTEMPTS[attempt] as readonly [number, number];
      let k = 0;
      const local = prep.rings.map((ring) =>
        ring.map((p): Vec2 => {
          // Golden-angle spiral: deterministic, and no two points move the same way.
          const angle = ++k * 2.399963229728653 + attempt;
          return [
            p[0] - prep.center[0] + jitter * Math.cos(angle),
            p[1] - prep.center[1] + jitter * Math.sin(angle),
          ];
        }),
      );
      const raw = propagate(local, delay, factor * prep.scale);
      if (!raw) continue;
      const result = assemble(prep, delay, raw, attempt);
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}
