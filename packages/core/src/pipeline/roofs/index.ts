import { straightSkeleton } from '../../geom/skeleton';
import type { Vec2 } from '../../geom/vec2';
import type { FootprintMetrics, ResolvedSpec, RoofGeometry, RoofShape, WallSegment } from '../../types';
import { buildFlat } from './flat';
import { NEAR_RECTANGLE, buildGabled, buildGambrel, buildHalfHipped, buildMansard } from './gabled';
import { buildHipped, canBuildHipped } from './hipped';
import { buildPyramidal } from './pyramidal';
import { buildRadial } from './radial';
import { buildRound } from './round';
import { buildSawtooth } from './sawtooth';
import { buildSkillion } from './skillion';

export interface RoofContext {
  spec: ResolvedSpec;
  walls: WallSegment[];
  /** Overhang per outer-ring edge in metres (0 along blocked walls). */
  overhang: number[];
  /** Absolute height of the eave line above the ground. */
  eave: number;
}

/**
 * The shape that will actually be built for a wanted shape on this footprint.
 * Resolve uses this so the spec always names a shape the roof stage can deliver.
 */
export function supportedRoofShape(
  shape: RoofShape,
  metrics: FootprintMetrics,
  hasHoles: boolean,
  /** True when the caller asked for this shape (a tag), false when it is being rolled. */
  explicit = false,
): RoofShape {
  if (hasHoles) {
    // Around a courtyard only the skeleton roof works; everything pitched becomes hipped.
    if (shape === 'flat' || shape === 'skillion') return 'flat';
    // A tagged gable is kept when the holes are small (towers standing inside the body):
    // one ridge on the box axis with the holes cut out. Around a real courtyard, and for
    // rolled shapes, the roof becomes hipped: a ring of roof suits those better.
    const outerArea = metrics.rectangularity * 4 * metrics.box.halfLength * metrics.box.halfWidth;
    const holeShare = outerArea > 0 ? 1 - metrics.area / outerArea : 1;
    const gableLike =
      shape === 'gabled' || shape === 'round' || shape === 'half-hipped' || shape === 'gambrel';
    if (explicit && gableLike && holeShare < 0.12) return 'gabled';
    return canBuildHipped(metrics) ? 'hipped' : 'flat';
  }
  const aspect = metrics.box.halfWidth > 0 ? metrics.box.halfLength / metrics.box.halfWidth : 99;
  switch (shape) {
    case 'flat':
    case 'gabled':
    case 'skillion':
    case 'half-hipped':
    case 'gambrel':
      // The last two fall back to plain gabled when the footprint has no gable ends.
      return shape;
    case 'mansard':
      return canBuildHipped(metrics) ? 'mansard' : 'gabled';
    case 'pyramidal':
      // A tagged pyramid is tried on any footprint (apses, towers); a rolled one only on squarish ones.
      return explicit || (metrics.rectangularity > 0.75 && aspect < 1.5)
        ? 'pyramidal'
        : supportedRoofShape('hipped', metrics, hasHoles);
    case 'dome':
    case 'onion':
    case 'cone':
    case 'round':
      return shape;
    case 'hipped':
      return canBuildHipped(metrics) ? 'hipped' : 'gabled';
    case 'sawtooth':
      // Strips across the axis need a footprint that is long enough for at least one tooth;
      // rolled ones also a near-rectangle, so every tooth runs across the whole hall.
      if (metrics.box.halfLength < 2.5) return 'flat';
      return explicit || metrics.rectangularity > 0.85 ? 'sawtooth' : 'flat';
  }
}

/**
 * Half the width the roof rises over, i.e. what the pitch is multiplied with to get
 * the roof height. For a rectangle that is half its width. A footprint with wings
 * is roofed wing by wing, so it is half the width of the widest wing: the highest
 * point of the straight skeleton. (The oriented box would give L and U shapes and
 * courtyard blocks roofs two to three times too steep.)
 */
export function roofHalfSpan(
  shape: RoofShape,
  footprint: { outer: Vec2[]; holes: Vec2[][] },
  metrics: FootprintMetrics,
  across: boolean,
): number {
  const box = across ? metrics.box.halfLength : metrics.box.halfWidth;
  const perWing = !['flat', 'skillion', 'pyramidal', 'dome', 'onion', 'cone', 'round', 'sawtooth'].includes(
    shape,
  );
  if (!perWing || across) return box;
  if (footprint.holes.length === 0 && metrics.rectangularity > NEAR_RECTANGLE) return box;
  const skeleton = straightSkeleton(footprint.outer, footprint.holes);
  return skeleton ? Math.min(box, skeleton.maxTime) : box;
}

/** Stage 2b. Builds the roof for the resolved shape; falls back to flat if a builder gives up. */
export function buildRoof(ctx: RoofContext): RoofGeometry {
  const { spec } = ctx;
  const hasHoles = spec.footprint.holes.length > 0;
  let roof: RoofGeometry | null = null;
  switch (spec.roof.shape) {
    case 'gabled':
      roof = buildGabled(ctx);
      break;
    case 'skillion':
      roof = hasHoles ? null : buildSkillion(ctx);
      break;
    case 'pyramidal':
    case 'cone':
    case 'dome':
    case 'onion':
      if (!hasHoles)
        roof = spec.roof.shape === 'pyramidal' ? buildPyramidal(ctx) : buildRadial(ctx, spec.roof.shape);
      if (!roof) {
        // No centre that sees every edge (an L-shaped tower, a courtyard): the skeleton roof is the closest thing.
        roof = buildHipped(ctx);
        if (roof) spec.notes.push(`${spec.roof.shape} roof needs a compact footprint, using hipped`);
      }
      break;
    case 'round':
      roof = hasHoles ? null : buildRound(ctx);
      if (!roof && !hasHoles) roof = buildGabled(ctx);
      break;
    case 'sawtooth':
      roof = hasHoles ? null : buildSawtooth(ctx);
      break;
    case 'hipped':
    case 'mansard':
      roof = spec.roof.shape === 'mansard' && !hasHoles ? buildMansard(ctx) : null;
      roof ??= buildHipped(ctx);
      if (!roof && !hasHoles) {
        spec.notes.push(`${spec.roof.shape} roof: straight skeleton failed, using gabled`);
        roof = buildGabled(ctx);
      }
      break;
    case 'half-hipped':
    case 'gambrel':
      if (hasHoles) break;
      roof = spec.roof.shape === 'gambrel' ? buildGambrel(ctx) : buildHalfHipped(ctx);
      if (!roof) {
        spec.notes.push(`${spec.roof.shape} roof: no gable ends to work with, using gabled`);
        roof = buildGabled(ctx);
      }
      break;
    default:
      roof = null;
  }
  if (!roof) {
    if (spec.roof.shape !== 'flat') spec.notes.push(`roof builder for ${spec.roof.shape} failed, using flat`);
    roof = buildFlat(ctx);
  }
  return roof;
}

export const noBreaks = (): number[] => [];
export const zeroHeight = (_p: Vec2): number => 0;
