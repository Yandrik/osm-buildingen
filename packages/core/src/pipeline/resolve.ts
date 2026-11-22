import { type Colour, parseColour, shade } from '../colour';
import { cleanRing, orientedBox, perimeter, polygonArea, ringArea } from '../geom/polygon';
import type { Vec2 } from '../geom/vec2';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { type Curve, type PaletteSet, type TypeStyle, type Weighted, evalCurve } from '../styles/types';
import {
  type BuildingInput,
  BuildingInputError,
  type BuildingType,
  type FootprintMetrics,
  type Palette,
  type ResolvedRoof,
  type ResolvedSpec,
  type RoofShape,
  type WallStyle,
} from '../types';
import { GENERATOR_VERSION } from '../version';
import { roofHalfSpan, supportedRoofShape } from './roofs';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const mm = (v: number): number => Math.round(v * 1000) / 1000;

/** Construction year -> era (0..1). See plan/styles/modernity.md. */
const YEAR_TO_ERA: Curve = [
  [1850, 0],
  [1930, 0.25],
  [1962, 0.5],
  [1992, 0.75],
  [2015, 1],
];

function pickWeighted<T>(
  rng: Rng,
  table: Weighted<T>,
  era: number,
  allow?: (value: T) => boolean,
): T | undefined {
  const weights = table.map(([value, curve]) =>
    allow && !allow(value) ? 0 : Math.max(0, evalCurve(curve, era)),
  );
  const index = rng.weightedIndex(weights);
  return index < 0 ? undefined : (table[index] as readonly [T, Curve])[0];
}

function pickColour(rng: Rng, table: Weighted<string>, era: number, fallback: Colour): Colour {
  const text = pickWeighted(rng, table, era);
  return (text ? parseColour(text) : null) ?? fallback;
}

export function cleanFootprint(input: BuildingInput): { outer: Vec2[]; holes: Vec2[][] } {
  const outer = cleanRing(input.footprint.outer, true);
  if (outer.length < 3) throw new BuildingInputError('Footprint needs at least 3 distinct points');
  if (ringArea(outer) < 0.5) throw new BuildingInputError('Footprint area is below 0.5 m²');
  for (const p of outer) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]))
      throw new BuildingInputError('Footprint has non-finite coordinates');
  }
  const holes: Vec2[][] = [];
  for (const h of input.footprint.holes ?? []) {
    const ring = cleanRing(h, false);
    if (ring.length >= 3 && ringArea(ring) >= 0.5) holes.push(ring);
  }
  return { outer, holes };
}

function measure(footprint: { outer: Vec2[]; holes: Vec2[][] }): FootprintMetrics {
  const box = orientedBox(footprint.outer);
  const area = polygonArea(footprint);
  const boxArea = 4 * box.halfLength * box.halfWidth;
  return {
    area,
    perimeter: perimeter(footprint.outer),
    box,
    rectangularity: boxArea > 0 ? clamp(ringArea(footprint.outer) / boxArea, 0, 1) : 0,
  };
}

function guessType(input: BuildingInput, m: FootprintMetrics): BuildingType {
  if (input.type) return input.type;
  if (m.area < 12) return 'shed';
  if (m.area < 45 && !input.hasAddress) return 'garage';
  if (m.area > 1500 && m.rectangularity > 0.8) return 'industrial';
  if (m.area > 400) return 'apartments';
  return 'house';
}

function roofHeightFromPitch(shape: RoofShape, pitchDeg: number, halfSpan: number): number {
  switch (shape) {
    case 'flat':
      return 0;
    case 'skillion':
      return Math.min(Math.tan(Math.min(pitchDeg, 15) * DEG) * 2 * halfSpan, 3.5);
    // Curved roofs have natural proportions rather than a pitch.
    case 'dome':
      return halfSpan;
    case 'onion':
      return halfSpan * 2.2;
    case 'round':
      return halfSpan * 0.6;
    case 'cone':
      return Math.min(halfSpan * 2, 14);
    // Height of one tooth; teeth are about 6 m wide whatever the footprint.
    case 'sawtooth':
      return Math.min(Math.max(Math.tan(pitchDeg * DEG) * 6, 1.6), 3.5);
    default:
      return Math.min(Math.tan(pitchDeg * DEG) * halfSpan, 9);
  }
}

/**
 * Stage 1. Fills in everything the input leaves open. Later stages read only the
 * returned spec. See plan/pipeline/01-resolve.md.
 */
export function resolve(input: BuildingInput): ResolvedSpec {
  const notes: string[] = [];
  const footprint = cleanFootprint(input);
  const metrics = measure(footprint);

  const pack = getStylePack(input.style.pack ?? input.style.region);
  const root = new Rng(seedFrom(GENERATOR_VERSION, 'building', input.seed));
  // Plot-wide choices (era, colours) come from the group so house and garage match.
  const group = new Rng(seedFrom(GENERATOR_VERSION, 'group', input.groupKey ?? input.seed));

  // --- Era ---
  let era: number;
  if (input.year !== undefined && Number.isFinite(input.year)) {
    era = evalCurve(YEAR_TO_ERA, input.year);
  } else {
    era = clamp(input.style.modernity, 0, 1) + group.fork('era').gauss() * 0.12;
  }
  era = Math.round(clamp(era, 0, 1) * 1000) / 1000;

  // --- Type ---
  let type = guessType(input, metrics);
  if (type === 'office' && ((input.height ?? 0) > 60 || (input.levels ?? 0) > 15)) {
    type = 'skyscraper';
    notes.push('office taller than 60 m or 15 levels treated as skyscraper');
  }
  const style: TypeStyle = pack.types[type];

  // --- Roof shape ---
  const hasHoles = footprint.holes.length > 0;
  const wanted =
    input.roof?.shape ??
    pickWeighted(
      root.fork('roofShape'),
      style.roofShapes,
      era,
      (s) => supportedRoofShape(s, metrics, hasHoles) === s,
    ) ??
    'flat';
  const shape = supportedRoofShape(wanted, metrics, hasHoles, input.roof?.shape !== undefined);
  if (shape !== wanted) notes.push(`roof shape ${wanted} not possible here, using ${shape}`);

  const across = input.roof?.ridge === 'across';
  const ridgeAxis = across ? metrics.box.side : metrics.box.axis;
  let slopeDirection: Vec2 = root.fork('slope').chance(0.5)
    ? metrics.box.side
    : [-metrics.box.side[0], -metrics.box.side[1]];
  if (input.roof?.direction !== undefined && Number.isFinite(input.roof.direction)) {
    const a = input.roof.direction * DEG;
    slopeDirection = [Math.sin(a), Math.cos(a)];
  }

  // --- Heights ---
  let nominalLevel = evalCurve(style.levelHeight, era);
  // Roofs on posts: a carport is lower than a fuel-station canopy.
  if (type === 'canopy') nominalLevel = clamp(2.2 + Math.sqrt(metrics.area) * 0.15, 2.6, 4.6);
  const base = Math.max(0, input.minHeight ?? 0);
  // A part that starts above the ground (a tower's shaft) has no taller ground floor.
  const groundExtra = base < 0.5 ? evalCurve(style.groundExtra, era) : 0;
  const pitch = evalCurve(style.roofPitch, era) + (root.fork('pitch').next() * 2 - 1) * style.roofPitchSpread;

  let roofHeight: number;
  if (shape === 'flat') roofHeight = 0;
  else if (input.roof?.height !== undefined && input.roof.height > 0) roofHeight = input.roof.height;
  else if (input.roof?.levels !== undefined && input.roof.levels > 0)
    roofHeight = input.roof.levels * nominalLevel * 0.9;
  else roofHeight = roofHeightFromPitch(shape, pitch, roofHalfSpan(shape, footprint, metrics, across));
  roofHeight = mm(roofHeight);

  let levels: number;
  let levelHeights: number[];
  if (input.height !== undefined && input.height > 0) {
    let wall = input.height - base - roofHeight;
    const minWall = Math.min(2.2, Math.max(0.5, input.height - base));
    if (wall < minWall) {
      wall = minWall;
      roofHeight = mm(Math.max(0, input.height - base - wall));
      notes.push('roof height reduced to fit the given total height');
    }
    levels =
      input.levels && input.levels >= 1
        ? Math.round(input.levels)
        : Math.max(1, Math.round(wall / nominalLevel));
    const extra = levels > 1 ? groundExtra : 0;
    const unit = wall / (levels * nominalLevel + extra);
    levelHeights = Array.from({ length: levels }, (_, i) =>
      mm((nominalLevel + (i === 0 ? extra : 0)) * unit),
    );
    // The top level takes the rounding, so the walls end exactly at the given height.
    const below = levelHeights.slice(0, -1).reduce((a, b) => a + b, 0);
    levelHeights[levels - 1] = mm(wall - below);
  } else {
    if (input.levels && input.levels >= 1) {
      levels = Math.round(input.levels);
    } else {
      const maxLevels = type === 'house' && metrics.area < 55 ? 2 : Number.POSITIVE_INFINITY;
      levels = pickWeighted(root.fork('levels'), style.levels, era, (n) => n <= maxLevels) ?? 1;
    }
    levelHeights = Array.from({ length: levels }, (_, i) =>
      mm(nominalLevel + (i === 0 && levels > 1 ? groundExtra : 0)),
    );
  }
  const wallHeight = mm(levelHeights.reduce((a, b) => a + b, 0));

  const overhang = mm(
    Math.max(
      0,
      input.roof?.overhang ?? evalCurve(shape === 'flat' ? (style.flatOverhang ?? 0) : style.overhang, era),
    ),
  );
  const roof: ResolvedRoof = {
    shape,
    height: shape === 'flat' ? 0 : roofHeight,
    ridgeAxis,
    slopeDirection,
    overhang,
    // A flat roof that reaches past the walls is a slab, not a parapet.
    parapet: shape === 'flat' && overhang === 0 ? mm(evalCurve(style.parapet, era)) : 0,
  };

  // --- Palette ---
  const lists: PaletteSet = { ...pack.palette, ...(style.palette ?? {}) };
  const wallList = style.inheritsGroupWall ? pack.palette.wall : lists.wall;
  const wall = parseColour(input.colours?.wall) ?? pickColour(group.fork('wall'), wallList, era, 0xe8e3da);
  const roofList = shape === 'flat' ? lists.roofFlat : lists.roof;
  const roofColour =
    parseColour(input.colours?.roof ?? input.roof?.colour) ??
    pickColour(group.fork('roof', shape === 'flat' ? 1 : 0), roofList, era, 0x8a8a8a);
  let trim = parseColour(input.colours?.trim) ?? pickColour(group.fork('trim'), lists.trim, era, 0xf5f5f0);
  if (trim === wall) trim = shade(wall, 0.82);
  const palette: Palette = {
    wall,
    base: shade(wall, era < 0.5 ? 0.72 : 0.85),
    roof: roofColour,
    trim,
    door: parseColour(input.colours?.door) ?? pickColour(root.fork('door'), lists.door, era, 0x7a4a2a),
    glass: parseColour(lists.glass) ?? 0xa8cfdf,
    frame: pickColour(group.fork('frame'), lists.frame, era, 0xf5f5f0),
    accent: pickColour(group.fork('accent'), lists.accent, era, 0x3a5a80),
    timber: pickColour(group.fork('timber'), lists.timber, era, 0x4a3426),
  };

  // --- Wall treatment and facade variant ---
  const wallStyle: WallStyle = pickWeighted(group.fork('wallStyle'), style.wallStyles, era) ?? 'plain';
  const wallStyleFromLevel =
    wallStyle === 'timber' && levels >= 2 && root.fork('timberFrom').chance(0.5) ? 1 : 0;
  const rolledVariant = style.variants
    ? (pickWeighted(group.fork('variant'), style.variants, era) ?? '')
    : '';
  const facadeVariant =
    input.facadeVariant !== undefined && style.tiles.some((t) => t.variant === input.facadeVariant)
      ? input.facadeVariant
      : rolledVariant;
  const symmetric = root.fork('symmetry').chance(evalCurve(style.symmetry, era));
  const attachedGarage =
    style.attachedGarage !== undefined &&
    root.fork('attachedGarage').chance(evalCurve(style.attachedGarage, era));

  let shop = false;
  if (type === 'store') shop = true;
  else if (type === 'townhouse') shop = input.shop ?? root.fork('shop').chance(input.shopProbability ?? 0.35);
  else if (type === 'apartments') shop = input.shop ?? false;

  return {
    type,
    packId: pack.id,
    region: input.style.region,
    era,
    footprint,
    metrics,
    base,
    levelHeights,
    wallHeight,
    roof,
    palette,
    wallStyle,
    wallStyleFromLevel,
    facadeVariant,
    symmetric,
    attachedGarage,
    shop,
    bayWidth: mm(evalCurve(style.bayWidth, era)),
    plinthHeight: mm(evalCurve(style.plinth, era)),
    notes,
  };
}
