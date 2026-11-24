import { shade } from '../colour';
import { intersection } from '../geom/boolean';
import { type OrientedBox, type Polygon, pointInRing, polygonArea, signedArea } from '../geom/polygon';
import type { Vec2 } from '../geom/vec2';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { type SteepleStyle, type Weighted, evalCurve } from '../styles/types';
import type { BuildingInput, PartInput, PartVolume, ResolvedSpec, RoofInput } from '../types';
import { GENERATOR_VERSION } from '../version';
import { resolve } from './resolve';

/*
 * Volumes of places of worship. See plan/styles/worship.md.
 *
 * Most churches in OSM are mapped with building:parts: towers, spires, pinnacles,
 * aisles. That geometry is kept as it is; each part only gets a role from its
 * shape, which picks its facade rows and tiles, and a roof colour where none is
 * mapped. Churches without parts get a ridge turret or a west tower of their own
 * (designs are style data), so even the far, massing-only view shows a spire.
 */

/** Smaller parts, or narrower ones, are pinnacles and buttresses. */
const SMALL_AREA = 4;
const SMALL_SIDE = 1.5;
/** Parts with lower walls carry only a roof (a spire mapped as a part of its own). */
const ROOF_ONLY_WALL = 2.5;
/** An oblong plan narrower than this is a buttress, however tall. */
const PIER_SIDE = 2.5;
const PIER_OBLONG = 1.5;
/** Walls this many times taller than the plan is long: a pier or a corner turret, not a tower. */
const PIER_SLENDER = 6;
/** A skillion this many times higher than the plan is long is the weathering of a buttress. */
const WEATHERING = 2;
/** A tower's wall top is at least this many times its longer side above the ground… */
const SLENDER = 1.4;
/** …and its footprint is at most this elongated. */
const SQUARISH = 2.2;

const mm = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** Mapped roof colours with every channel below this are lifted to anthracite. */
const DARKEST = 0x30;
const ANTHRACITE = '#646a73';
/** Roofs that taper to a point: they do not hide the wall of a part beside them. */
const POINTED = new Set(['pyramidal', 'cone', 'dome', 'onion']);

/** Role of one part of a place of worship, from its resolved geometry. */
export function volumeOf(spec: ResolvedSpec): PartVolume {
  const { halfLength, halfWidth } = spec.metrics.box;
  const long = 2 * Math.max(halfLength, halfWidth);
  const short = 2 * Math.min(halfLength, halfWidth);
  if (spec.metrics.area < SMALL_AREA || short < SMALL_SIDE || spec.wallHeight < ROOF_ONLY_WALL)
    return 'small';
  if (short < PIER_SIDE && long > PIER_OBLONG * short) return 'small';
  if (spec.wallHeight > PIER_SLENDER * long) return 'small';
  if (spec.roof.shape === 'skillion' && spec.roof.height >= WEATHERING * long) return 'small';
  const top = spec.base + spec.wallHeight;
  if (long <= SQUARISH * short && top >= SLENDER * long) return 'tower';
  return 'main';
}

/**
 * Gives a spec its role and, for types whose style lays rows out by volume
 * (`TypeStyle.rows`), divides its walls into rows: tall ones on the main body
 * (one window per bay from floor to eaves), stages about as high as the tower is
 * wide on towers, a single one on small parts.
 */
export function setVolume(spec: ResolvedSpec, volume: PartVolume): void {
  spec.volume = volume;
  const rows = getStylePack(spec.packId).types[spec.type].rows;
  if (!rows) return;
  const wall = spec.wallHeight;
  let n = 1;
  if (volume === 'main') n = Math.round(wall / evalCurve(rows.main, spec.era));
  else if (volume === 'tower') {
    const long = 2 * Math.max(spec.metrics.box.halfLength, spec.metrics.box.halfWidth);
    // Rounded down generously: a short top stage looks worse than a tall one.
    n = Math.round(wall / clamp(rows.towerPerWidth * long, rows.towerMin, rows.towerMax) - 0.25);
  }
  n = Math.max(1, n);
  const each = mm(wall / n);
  spec.levelHeights = Array.from({ length: n }, (_, i) => (i === n - 1 ? mm(wall - each * (n - 1)) : each));
}

/**
 * Height up to which a part of a place of worship hides the walls of the parts
 * beside it. The roof counts unless it tapers to a point: an aisle's lean-to roof
 * covers the nave wall behind it, a nave's gable the tower it runs into.
 */
export function blockingTop(spec: ResolvedSpec): number {
  const top = spec.base + spec.wallHeight;
  return POINTED.has(spec.roof.shape) ? top : top + spec.roof.height;
}

/**
 * Direction the front of a place of worship faces: along its length to the west
 * (churches face east), or to the south when it lies north-south.
 */
export function frontOf(box: OrientedBox): Vec2 {
  const { axis } = box;
  // Quantised: an axis within about 11° of north-south counts as north-south.
  const eastWest = Math.abs(axis[0]) > 0.2;
  const towardsWest = eastWest ? axis[0] > 0 : axis[1] > 0;
  return towardsWest ? [-axis[0], -axis[1]] : [axis[0], axis[1]];
}

/** The front part must be at least this wide to take the portal. */
const MIN_FRONT_SIDE = 4;
const MIN_FRONT_WALL = 2.6;

/**
 * The part that takes the main portal: the one reaching furthest towards the front
 * among those standing on the ground (the west tower, a porch, else the nave's own
 * end). Returns -1 when there is none.
 */
export function frontPart(
  specs: readonly (ResolvedSpec | null)[],
  volumes: readonly PartVolume[],
  front: Vec2,
): number {
  const reach = specs.map((s, i) => {
    if (!s || s.base >= 0.5 || volumes[i] === 'small') return Number.NEGATIVE_INFINITY;
    if (2 * Math.min(s.metrics.box.halfLength, s.metrics.box.halfWidth) < MIN_FRONT_SIDE)
      return Number.NEGATIVE_INFINITY;
    // It needs a wall towards the front that is wide enough for a portal (a round porch has none).
    const ring = s.footprint.outer;
    const faces = ring.some((p, k) => {
      const q = ring[(k + 1) % ring.length] as Vec2;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return length >= MIN_FRONT_WALL && ((q[1] - p[1]) * front[0] - (q[0] - p[0]) * front[1]) / length > 0.7;
    });
    if (!faces) return Number.NEGATIVE_INFINITY;
    return Math.max(...s.footprint.outer.map((p) => p[0] * front[0] + p[1] * front[1]));
  });
  const furthest = Math.max(...reach);
  if (!Number.isFinite(furthest)) return -1;
  // Among those ending level with each other a tower comes first, then the largest.
  let best = -1;
  let bestRank = 0;
  reach.forEach((r, i) => {
    if (r < furthest - 0.5) return;
    const rank = (volumes[i] === 'tower' ? 1e9 : 0) + (specs[i]?.metrics.area ?? 0);
    if (rank > bestRank) {
      bestRank = rank;
      best = i;
    }
  });
  return best;
}

function pickWeighted<T>(rng: Rng, table: Weighted<T>, era: number): T | undefined {
  const index = rng.weightedIndex(table.map(([, curve]) => Math.max(0, evalCurve(curve, era))));
  return index < 0 ? undefined : (table[index] as readonly [T, unknown])[0];
}

/** Colour for the tower roofs of this building, from the style's `spire` list. One per building. */
function spireColour(input: BuildingInput, spec: ResolvedSpec): string | undefined {
  const pack = getStylePack(spec.packId);
  const list = pack.types[spec.type].palette?.spire ?? pack.palette.spire;
  if (!list) return undefined;
  const group = new Rng(seedFrom(GENERATOR_VERSION, 'group', input.groupKey ?? input.seed));
  return pickWeighted(group.fork('spire'), list, spec.era);
}

/**
 * Roof colour for a part of a place of worship, or undefined to leave it as it is.
 * A mapped colour stays (pure black becomes anthracite). Without one:
 * - pinnacles, buttresses and their weatherings are stone like the walls;
 * - otherwise the building's own mapped roof colour (parts do not inherit it by themselves);
 * - towers with a pointed roof get the building's spire colour (slate, copper).
 */
export function partRoofColour(
  building: BuildingInput,
  part: BuildingInput,
  spec: ResolvedSpec,
  volume: PartVolume,
): string | undefined {
  if (spec.roof.shape === 'flat') return undefined;
  if (part.colours?.roof !== undefined || part.roof?.colour !== undefined) {
    // Mapped. Only pure black is softened: between stone walls a black lean-to reads as a hole.
    const { roof } = spec.palette;
    return Math.max(roof >> 16, (roof >> 8) & 0xff, roof & 0xff) < DARKEST ? ANTHRACITE : undefined;
  }
  if (volume === 'small') return hex(shade(spec.palette.wall, SMALL_SHADE));
  const mapped = building.colours?.roof ?? building.roof?.colour;
  if (mapped !== undefined) return mapped;
  return volume === 'tower' && POINTED.has(spec.roof.shape) ? spireColour(building, spec) : undefined;
}

/** Buttresses and pinnacles are a shade darker than the walls, so they stand out against them in flat light. */
const SMALL_SHADE = 0.92;

/** Wall colour for a part of a place of worship, or undefined to leave it as it is. */
export function partWallColour(spec: ResolvedSpec, volume: PartVolume): string | undefined {
  return volume === 'small' ? hex(shade(spec.palette.wall, SMALL_SHADE)) : undefined;
}

/** A body piece counts as lying under a raised part when this share of it does. */
const UNDER_SHARE = 0.5;

/**
 * Height at which a piece of the uncovered outline has to stop because a part
 * mapped above the ground stands over it (a porch below its own mapped roof, the
 * hall below a tower's upper stage), or undefined when nothing does. Without this
 * the piece would get walls and a roof of its own that poke through that part.
 */
export function lidOver(
  piece: Polygon,
  raised: readonly { footprint: Polygon; base: number }[],
): number | undefined {
  const area = polygonArea(piece);
  let lid: number | undefined;
  for (const r of raised) {
    const shared = intersection(piece, r.footprint);
    if (!shared || shared.reduce((sum, p) => sum + polygonArea(p), 0) < UNDER_SHARE * area) continue;
    if (lid === undefined || r.base < lid) lid = r.base;
  }
  return lid;
}

/** Below this footprint a church without parts gets a ridge turret, from it a west tower. */
const TOWER_AREA = 300;
const MIN_RECTANGULARITY = 0.75;
/** Ridge turrets are forgiving: a chapel with an apse or mapped buttresses still gets one. */
const MIN_TURRET_RECTANGULARITY = 0.6;
const RIDGED = new Set(['gabled', 'hipped', 'half-hipped']);
/** How far a west tower stands out of the west wall. */
const TOWER_PROUD = 0.3;
/** tan 22.5°, rounded so every engine places the octagons alike. */
const OCT_TAN = 0.414214;

/**
 * Tower or ridge turret for a place of worship mapped without parts. Returns null
 * when the building is not one, already has parts, its shape does not suggest
 * where a tower would stand (not rectangular, no ridge along its length), or the
 * style has no steeple for its architecture and faith.
 *
 * The tower stands at the west end (see `frontOf`), inside the outline and flush
 * with the west wall; the turret sits on the ridge near that end. What they look
 * like is style data (`TypeStyle.steeples`): a shaft, stages on it, a roof,
 * pinnacles. All of it is returned as parts.
 *
 * Also returns the input with height and roof pinned to what the parts were fitted
 * to: the body is built as a part with a seed of its own and would roll them anew.
 */
export function worshipParts(input: BuildingInput): { input: BuildingInput; parts: PartInput[] } | null {
  if (input.parts && input.parts.length > 0) return null;
  if (input.type !== 'worship' || (input.minHeight ?? 0) > 0) return null;
  let spec: ResolvedSpec;
  try {
    // Same group key as the parts will get, so the era matches theirs.
    spec = resolve({ ...input, groupKey: input.groupKey ?? `self:${input.seed}` });
  } catch {
    return null; // generateOne reports the unusable footprint
  }
  const steeples = getStylePack(spec.packId).types[spec.type].steeples;
  if (!steeples) return null;
  const { metrics, roof } = spec;
  const tower = metrics.area >= TOWER_AREA;
  const minRect = tower ? MIN_RECTANGULARITY : MIN_TURRET_RECTANGULARITY;
  if (metrics.rectangularity < minRect || spec.footprint.holes.length > 0) return null;
  if (!RIDGED.has(roof.shape) || input.roof?.ridge === 'across') return null;

  const fits = (s: SteepleStyle): boolean =>
    (!s.variants || s.variants.includes(spec.facadeVariant)) &&
    (s.faiths ?? ['christian']).includes(spec.faith);
  const designs = (tower ? steeples.towers : steeples.turrets).filter(fits);
  const rng = new Rng(seedFrom(GENERATOR_VERSION, 'steeple', input.seed));
  const design = pickWeighted(
    rng,
    designs.map((d) => [d, d.weight] as const),
    spec.era,
  );
  if (!design) return null;

  const { center: c, side, halfLength, halfWidth } = metrics.box;
  const a = frontOf(metrics.box);
  const eave = spec.base + spec.wallHeight;
  const ridge = eave + roof.height;
  const width = 2 * halfWidth;
  const octagon = !tower && design.plan === 'octagon';

  // Half the shaft's width, and how far its centre lies from the middle of the box towards the front.
  let h: number;
  let d: number;
  let base: number | undefined;
  if (tower) {
    h = mm(clamp(0.25 * width, 2.25, 5.5));
    // Standing a little proud of the west wall: flush, rounding would leave a sliver of nave in front of it.
    d = halfLength - h + TOWER_PROUD;
  } else {
    h = octagon ? mm(clamp(0.125 * width, 1.5, 2)) : mm(clamp(0.11 * width, 1.1, 1.75));
    // On the ridge: a hip takes the ridge's end away, so the turret moves in with it.
    // (An outline that is no plain rectangle may get its front end hipped too, see `hippedEnds`.)
    const hipped = roof.shape === 'hipped' || spec.footprint.outer.length > 4;
    const hip = hipped ? halfWidth : roof.shape === 'half-hipped' ? halfWidth * 0.5 : 0;
    d = Math.max(0, halfLength - Math.max(0.22 * halfLength, h + 1, hip + h));
    // Starts inside the roof, below where its corners come out of the slopes.
    base = mm(eave + roof.height * 0.7);
  }
  const m: Vec2 = [c[0] + a[0] * d, c[1] + a[1] * d];
  /** Counter-clockwise ring around (x along the axis, y across it) from the shaft's centre. */
  const ring = (points: readonly (readonly [number, number])[]): Vec2[] => {
    const out = points.map(
      ([x, y]): Vec2 => [mm(m[0] + a[0] * x + side[0] * y), mm(m[1] + a[1] * x + side[1] * y)],
    );
    return signedArea(out) < 0 ? out.reverse() : out;
  };
  const square = (half: number, x = 0, y = 0): Vec2[] =>
    ring([
      [x - half, y - half],
      [x + half, y - half],
      [x + half, y + half],
      [x - half, y + half],
    ]);
  /** Octagon whose flats lie `half` from the centre, parallel to the shaft's sides. */
  const octagonRing = (half: number): Vec2[] => {
    const t = half * OCT_TAN;
    return ring([
      [half, -t],
      [half, t],
      [t, half],
      [-t, half],
      [-half, t],
      [-half, -t],
      [-t, -half],
      [t, -half],
    ]);
  };
  const plan = (kind: 'square' | 'octagon', half: number): Vec2[] =>
    kind === 'octagon' ? octagonRing(half) : square(half);

  const shaft = plan(octagon ? 'octagon' : 'square', h);
  if (tower) {
    // Its inner corners must lie inside the outline (the outer ones stand proud of it).
    const inner = square(h, -2 * TOWER_PROUD);
    const inside = inner.every((p) => {
      const q: Vec2 = [p[0] + (c[0] - p[0]) * 0.02, p[1] + (c[1] - p[1]) * 0.02];
      return pointInRing(q, spec.footprint.outer);
    });
    if (!inside) return null;
  }

  const w = 2 * h;
  const stages = design.stages ?? [];
  // A steeple is roofed in its own material (slate, copper), not in the nave's tiles.
  const colour = design.roof.colour ?? spireColour(input, spec) ?? input.colours?.roof ?? input.roof?.colour;
  const roofOn = (standsOn: number): RoofInput => ({
    shape: design.roof.shape,
    height: mm(design.roof.height * standsOn),
    ...(design.roof.profile ? { profile: design.roof.profile } : {}),
    ...(colour !== undefined ? { colour } : {}),
  });

  const parts: PartInput[] = [];
  let top = mm(ridge + design.rise * w);
  {
    const last = stages.length === 0;
    const r = last ? roofOn(w) : { shape: 'flat' as const };
    parts.push({
      footprint: { outer: shaft },
      ...(base !== undefined ? { minHeight: base } : {}),
      height: mm(top + (r.height ?? 0)),
      roof: r,
    });
  }
  const shaftTop = top;
  stages.forEach((stage, k) => {
    const last = k === stages.length - 1;
    const sw = stage.width * w;
    const r = last ? roofOn(sw) : { shape: 'flat' as const };
    const walls = mm(stage.walls * w);
    parts.push({
      footprint: { outer: plan(stage.plan, mm(sw / 2)) },
      minHeight: top,
      height: mm(top + walls + (r.height ?? 0)),
      roof: r,
    });
    top = mm(top + walls);
  });
  if (design.pinnacles && stages.length > 0) {
    const p = design.pinnacles;
    const half = mm((p.width * w) / 2);
    const o = h - half;
    for (const [x, y] of [
      [o, o],
      [o, -o],
      [-o, o],
      [-o, -o],
    ] as const) {
      parts.push({
        footprint: { outer: square(half, x, y) },
        minHeight: shaftTop,
        height: mm(shaftTop + (p.walls + p.roof) * w),
        roof: { shape: 'pyramidal', height: mm(p.roof * w) },
      });
    }
  }

  // A plain rectangle may get a polygonal east end: the corners away from the front are cut
  // off, and the roof is hipped over them (around a west tower it is then hipped as well,
  // which also spares the stubs beside the tower their little gables).
  const cut = mm(Math.min(0.3 * width, 0.5 * halfLength));
  const apse =
    spec.footprint.outer.length === 4 &&
    metrics.rectangularity > 0.98 &&
    cut >= 1.5 &&
    rng.fork('apse').chance(evalCurve(steeples.apse ?? 0, spec.era));
  const outline = (points: readonly (readonly [number, number])[]): Vec2[] => {
    const out = points.map(
      ([x, y]): Vec2 => [mm(c[0] + a[0] * x + side[0] * y), mm(c[1] + a[1] * x + side[1] * y)],
    );
    return signedArea(out) < 0 ? out.reverse() : out;
  };
  const pinned: BuildingInput = {
    ...input,
    ...(apse
      ? {
          footprint: {
            outer: outline([
              [halfLength, -halfWidth],
              [halfLength, halfWidth],
              [-halfLength + cut, halfWidth],
              [-halfLength, halfWidth - cut],
              [-halfLength, -halfWidth + cut],
              [-halfLength + cut, -halfWidth],
            ]),
          },
        }
      : {}),
    height: mm(ridge),
    roof: { ...input.roof, shape: apse && tower ? 'hipped' : roof.shape, height: roof.height },
  };
  return { input: pinned, parts };
}
