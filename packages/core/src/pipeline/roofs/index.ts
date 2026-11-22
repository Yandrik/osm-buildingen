import { straightSkeleton } from '../../geom/skeleton';
import type { Vec2 } from '../../geom/vec2';
import type { FootprintMetrics, ResolvedSpec, RoofGeometry, RoofShape, WallSegment } from '../../types';
import { buildFlat } from './flat';
import { NEAR_RECTANGLE, buildGabled, buildGambrel, buildHalfHipped, buildMansard } from './gabled';
import { buildHipped, canBuildHipped } from './hipped';
import { buildPyramidal } from './pyramidal';
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
): RoofShape {
  if (hasHoles) {
    // Around a courtyard only the skeleton roof works; everything pitched becomes hipped.
    if (shape === 'flat' || shape === 'skillion') return 'flat';
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
      return metrics.rectangularity > 0.75 && aspect < 1.5
        ? 'pyramidal'
        : supportedRoofShape('hipped', metrics, hasHoles);
    case 'hipped':
      return canBuildHipped(metrics) ? 'hipped' : 'gabled';
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
  const perWing = shape !== 'flat' && shape !== 'skillion' && shape !== 'pyramidal';
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
      roof = hasHoles ? null : buildGabled(ctx);
      break;
    case 'skillion':
      roof = hasHoles ? null : buildSkillion(ctx);
      break;
    case 'pyramidal':
      roof = hasHoles ? null : buildPyramidal(ctx);
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
