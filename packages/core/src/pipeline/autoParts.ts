import { offsetRing, pointInRing, signedArea } from '../geom/polygon';
import { straightSkeleton } from '../geom/skeleton';
import { type Vec2, cross, sub } from '../geom/vec2';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { type CrownKind, type TowerStyle, type Weighted, evalCurve } from '../styles/types';
import type { BuildingInput, PartInput, ResolvedSpec, RoofInput } from '../types';
import { GENERATOR_VERSION } from '../version';
import { resolve } from './resolve';

/** Below this many levels a tower stays a plain prism. */
const MIN_LEVELS = 10;
/** Short side of the footprint's box below which there is no room for setbacks. */
const MIN_WIDTH = 16;
const MIN_RECTANGULARITY = 0.7;
/** No tier gets narrower than this. */
const MIN_TIER_WIDTH = 7;
/** Shaft levels at least, between podium and crown. */
const MIN_SHAFT = 4;
/** Keep insets this far before the skeleton's first event, where the offset stops being a plain offset. */
const EVENT_MARGIN = 0.3;

const mm = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function pick<T>(rng: Rng, table: Weighted<T>, era: number): T | undefined {
  const index = rng.weightedIndex(table.map(([, curve]) => Math.max(0, evalCurve(curve, era))));
  return index < 0 ? undefined : (table[index] as readonly [T, unknown])[0];
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Counter-clockwise, not self-intersecting, and not degenerate. */
function isSimple(ring: readonly Vec2[]): boolean {
  const n = ring.length;
  if (n < 3 || !(signedArea(ring) > 1)) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (
        segmentsCross(ring[i] as Vec2, ring[(i + 1) % n] as Vec2, ring[j] as Vec2, ring[(j + 1) % n] as Vec2)
      )
        return false;
    }
  }
  return true;
}

/** How far a footprint can be shrunk: until its first skeleton event, and its thickest point. */
interface Room {
  firstEvent: number;
  maxTime: number;
}

function insetRoom(outer: readonly Vec2[]): Room | null {
  const skeleton = straightSkeleton(outer);
  if (!skeleton) return null;
  let firstEvent = skeleton.maxTime;
  for (const node of skeleton.nodes) if (node.time > 1e-6 && node.time < firstEvent) firstEvent = node.time;
  return { firstEvent, maxTime: skeleton.maxTime };
}

/**
 * Synthesises podium, shaft and crown parts for a tower without mapped parts.
 * Returns null (plain prism) when the building is not a tower, is too small or
 * oddly shaped, or the style has no tower section. See plan/styles/non-residential.md.
 *
 * The parts follow the building's level grid, so window rows line up between tiers,
 * and the highest part ends exactly at the resolved height of the building.
 */
export function autoParts(input: BuildingInput): PartInput[] | null {
  if (input.parts && input.parts.length > 0) return null;
  // Towers are never guessed from the footprint, so the type is in the input.
  if (input.type !== 'skyscraper' && input.type !== 'office') return null;
  if ((input.minHeight ?? 0) > 0) return null;
  if (input.roof?.shape !== undefined && input.roof.shape !== 'flat') return null;

  let spec: ResolvedSpec;
  try {
    // Same group key as the parts will get, so era and level heights match theirs.
    spec = resolve({ ...input, groupKey: input.groupKey ?? `self:${input.seed}` });
  } catch {
    return null; // generateOne reports the unusable footprint
  }
  if (spec.type !== 'skyscraper') return null;
  const style: TowerStyle | undefined = getStylePack(spec.packId).types.skyscraper.tower;
  const n = spec.levelHeights.length;
  const { metrics } = spec;
  const width = 2 * metrics.box.halfWidth;
  if (!style || n < MIN_LEVELS || spec.footprint.holes.length > 0) return null;
  if (width < MIN_WIDTH || metrics.rectangularity < MIN_RECTANGULARITY) return null;
  const outer = spec.footprint.outer;
  const room = insetRoom(outer);
  if (!room) return null;

  const rng = new Rng(seedFrom(GENERATOR_VERSION, 'tower', input.seed));
  const era = spec.era;

  /** Top of level k above the ground (top[0] = 0, top[n] = wall height). */
  const top: number[] = [0];
  for (const h of spec.levelHeights) top.push(mm((top[top.length - 1] as number) + h));
  top[n] = spec.base + spec.wallHeight;

  /** The footprint shrunk by `d`, or null when that is not a clean offset any more. */
  const inset = (d: number): Vec2[] | null => {
    if (d <= 0) return outer;
    if (d > room.firstEvent - EVENT_MARGIN || room.maxTime - d < MIN_TIER_WIDTH / 2) return null;
    const ring = offsetRing(outer, -d);
    return isSimple(ring) ? ring : null;
  };
  /** Box-aligned rectangle around the footprint's centre, if it fits inside `ring`. */
  const centred = (halfL: number, halfW: number, ring: readonly Vec2[]): Vec2[] | null => {
    const { center: c, axis: a, side: s } = metrics.box;
    const corners: Vec2[] = [
      [c[0] - a[0] * halfL - s[0] * halfW, c[1] - a[1] * halfL - s[1] * halfW],
      [c[0] + a[0] * halfL - s[0] * halfW, c[1] + a[1] * halfL - s[1] * halfW],
      [c[0] + a[0] * halfL + s[0] * halfW, c[1] + a[1] * halfL + s[1] * halfW],
      [c[0] - a[0] * halfL + s[0] * halfW, c[1] - a[1] * halfL + s[1] * halfW],
    ];
    // Inside with a margin: test points pushed outward by 0.5 m.
    const ok = corners.every((p) => {
      const out: Vec2 = [p[0] + (p[0] - c[0]) * 0.05, p[1] + (p[1] - c[1]) * 0.05];
      return pointInRing(out, ring);
    });
    return ok ? corners : null;
  };
  const octagon = (r: number): Vec2[] => {
    const { center: c, axis: a, side: s } = metrics.box;
    return Array.from({ length: 8 }, (_, k): Vec2 => {
      const t = ((k + 0.5) / 8) * 2 * Math.PI;
      // Quantised so the ring is identical on every engine.
      const u = Math.round(Math.cos(t) * 1e6) / 1e6;
      const v = Math.round(Math.sin(t) * 1e6) / 1e6;
      return [c[0] + (a[0] * u + s[0] * v) * r, c[1] + (a[1] * u + s[1] * v) * r];
    });
  };

  /**
   * One tier from level `from` to level `to`. The top `cap` levels are taken by the
   * roof, so `to` is where the tier really ends.
   */
  const part = (
    ring: readonly Vec2[],
    from: number,
    to: number,
    roof: RoofInput = { shape: 'flat' },
    cap = 0,
    facadeVariant?: string,
  ): PartInput => ({
    footprint: { outer: ring },
    minLevel: from,
    levels: to - cap,
    minHeight: top[from] as number,
    height: top[to] as number,
    roof: cap > 0 ? { ...roof, height: mm((top[to] as number) - (top[to - cap] as number)) } : roof,
    ...(facadeVariant ? { facadeVariant } : {}),
  });

  // --- Podium ---
  const podiumLevels = clamp(
    pick(rng.fork('podium'), style.podiumLevels, era) ?? 2,
    1,
    Math.max(1, Math.floor(n * 0.15)),
  );
  const podiumVariant = pick(rng.fork('podiumVariant'), style.podiumVariants, era) || undefined;

  // --- Shaft ---
  const shaftInset = clamp(width * rng.fork('shaftInset').range(0.06, 0.1), 1.5, 4);
  const shaft = inset(shaftInset);
  if (!shaft) return null;

  const crown: CrownKind = pick(rng.fork('crown'), style.crowns, era) ?? 'penthouse';
  const crownRng = rng.fork('crownShape');
  const step = clamp(width * 0.07, 1.5, 3.5);
  const tiers: PartInput[] = [];
  /** Level where the shaft ends; the crown takes the rest. */
  let shaftTop = n;
  const shaftRoof: { roof?: RoofInput; cap: number } = { cap: 0 };

  const levelsFor = (share: number): number => Math.max(1, Math.round(n * share));

  switch (crown) {
    case 'setback':
    case 'tower': {
      const wanted = crown === 'setback' ? 2 + crownRng.int(2) : 1;
      const rings: Vec2[][] = [];
      for (let k = 1; k <= wanted; k++) {
        const ring = inset(shaftInset + step * k);
        if (!ring) break;
        rings.push(ring);
      }
      const tierLevels = rings.map(() => levelsFor(crownRng.range(0.06, 0.1)));
      let spire: { ring: Vec2[]; levels: number; cap: number } | null = null;
      if (crown === 'tower') {
        const last = rings[rings.length - 1] ?? shaft;
        const half = clamp(width * 0.17, 3, 6);
        const ring = centred(half, half, last);
        if (ring) spire = { ring, levels: 4 + crownRng.int(3), cap: 2 };
      }
      const capLevels = crown === 'setback' ? 1 + crownRng.int(2) : 0;
      // The topmost tier carries the cap and needs at least one storey of wall under it.
      if (rings.length > 0 && !spire) {
        const i = tierLevels.length - 1;
        tierLevels[i] = Math.max(tierLevels[i] as number, capLevels + 1);
      }
      const crownLevels = tierLevels.reduce((s, v) => s + v, 0) + (spire ? spire.levels : 0);
      if (n - crownLevels - podiumLevels < MIN_SHAFT) break; // too short for a crown: plain top
      shaftTop = n - crownLevels;
      let level = shaftTop;
      rings.forEach((ring, k) => {
        const to = level + (tierLevels[k] as number);
        const isTop = k === rings.length - 1 && !spire;
        const aspect = metrics.box.halfLength / Math.max(1e-6, metrics.box.halfWidth);
        const shape = aspect < 1.4 ? 'pyramidal' : 'hipped';
        tiers.push(
          isTop && capLevels > 0 ? part(ring, level, to, { shape }, capLevels) : part(ring, level, to),
        );
        level = to;
      });
      if (rings.length === 0 && !spire && capLevels > 0) {
        // No room for setbacks: the cap sits on the shaft itself.
        shaftTop = n;
        shaftRoof.roof = { shape: 'hipped' };
        shaftRoof.cap = capLevels;
      }
      if (spire) tiers.push(part(spire.ring, level, n, { shape: 'pyramidal' }, spire.cap));
      break;
    }
    case 'penthouse': {
      const plantLevels = n >= 24 && crownRng.chance(0.4) ? 2 : 1;
      if (n - plantLevels - podiumLevels < MIN_SHAFT) break;
      const frac = crownRng.range(0.45, 0.6);
      const ring =
        centred(metrics.box.halfLength * frac, metrics.box.halfWidth * frac, shaft) ??
        inset(shaftInset + metrics.box.halfWidth * (1 - frac));
      if (!ring) break;
      shaftTop = n - plantLevels;
      tiers.push(part(ring, shaftTop, n, undefined, 0, style.plantVariant));
      break;
    }
    case 'glass': {
      // One tall storey of glass in place of the top two.
      const ring = inset(shaftInset + clamp(width * 0.05, 1.2, 2));
      if (!ring || n - 2 - podiumLevels < MIN_SHAFT) break;
      shaftTop = n - 2;
      tiers.push({ ...part(ring, shaftTop, n, undefined, 0, style.glassVariant), levels: shaftTop + 1 });
      break;
    }
    case 'chamfer': {
      const cap = 2 + crownRng.int(3);
      if (n - cap - podiumLevels < MIN_SHAFT) break;
      const dir = [metrics.box.axis, metrics.box.side][crownRng.int(2)] as Vec2;
      const sign = crownRng.chance(0.5) ? 1 : -1;
      const bearing = (Math.atan2(dir[0] * sign, dir[1] * sign) * 180) / Math.PI;
      // The cut is glazed.
      const glass = `#${spec.palette.glass.toString(16).padStart(6, '0')}`;
      shaftRoof.roof = { shape: 'skillion', direction: Math.round(bearing * 10) / 10, colour: glass };
      shaftRoof.cap = cap;
      break;
    }
    case 'spire': {
      const levels = 3 + crownRng.int(3);
      if (n - levels - podiumLevels < MIN_SHAFT) break;
      const frac = crownRng.range(0.3, 0.4);
      const base = centred(metrics.box.halfLength * frac, metrics.box.halfWidth * frac, shaft);
      if (!base) break;
      shaftTop = n - levels;
      tiers.push(part(base, shaftTop, shaftTop + 1, undefined, 0, style.plantVariant));
      const radius = clamp(width * 0.035, 0.7, 1.3);
      // Short wall, then the cone up to the very top.
      const from = shaftTop + 1;
      const spire = part(octagon(radius), from, n, { shape: 'cone' }, 0, style.plantVariant);
      const wall = 2.2;
      tiers.push({
        ...spire,
        levels: from + 1,
        roof: { shape: 'cone', height: mm((top[n] as number) - (top[from] as number) - wall) },
      });
      break;
    }
  }

  const parts: PartInput[] = [
    part(outer, 0, podiumLevels, { shape: 'flat' }, 0, podiumVariant),
    part(shaft, podiumLevels, shaftTop, shaftRoof.roof, shaftRoof.cap),
    ...tiers,
  ];
  return parts;
}
