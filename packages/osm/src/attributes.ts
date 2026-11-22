import type { ColourInput, PartInput, Polygon, RoofInput } from '@osm-buildingen/core';
import {
  parseDirection,
  parseLength,
  parseLevels,
  parseRidge,
  parseRoofShape,
  parseYear,
  tagValue,
} from './tags';
import type { Tags } from './types';

/** Level height used only where the adapter itself must turn levels into metres (min_level, neighbour heights). */
export const NOMINAL_LEVEL = 3;
/** Roof level height for neighbour height estimates. */
const NOMINAL_ROOF_LEVEL = 2.7;

/** Dimensions and looks read from building or part tags. */
export interface Attributes {
  height?: number;
  minHeight?: number;
  /** Levels above `minLevel` (S3DB: `building:levels` counts from the ground, `building:min_level` are skipped). */
  levels?: number;
  /** Raw `building:levels`. */
  rawLevels?: number;
  minLevel?: number;
  /** True when `minHeight` was derived from `building:min_level` rather than tagged. */
  minHeightFromLevels?: boolean;
  roof?: RoofInput;
  colours?: ColourInput;
  year?: number;
}

/** Reads `height`, `min_height`, levels, `roof:*`, colours and `start_date`. */
export function readAttributes(tags: Tags): Attributes {
  const out: Attributes = {};
  const height = parseLength(tags.height);
  if (height !== undefined && height > 0) out.height = height;
  const minLevel = parseLevels(tags['building:min_level']);
  if (minLevel !== undefined && minLevel > 0) out.minLevel = minLevel;
  const minHeight = parseLength(tags.min_height);
  // A min_height at or above the height is a tagging error; drop it rather than produce a zero-height volume.
  const below = (v: number): boolean => out.height === undefined || v < out.height;
  if (minHeight !== undefined && minHeight > 0) {
    if (below(minHeight)) out.minHeight = minHeight;
  } else if (out.minLevel !== undefined && below(out.minLevel * NOMINAL_LEVEL)) {
    out.minHeight = out.minLevel * NOMINAL_LEVEL;
    out.minHeightFromLevels = true;
  }

  const levels = parseLevels(tags['building:levels']);
  if (levels !== undefined && levels > 0) {
    out.rawLevels = levels;
    const above = levels - (out.minLevel ?? 0);
    if (above >= 1) out.levels = above;
  }

  const roof: RoofInput = {};
  const shape = parseRoofShape(tags['roof:shape']);
  if (shape) roof.shape = shape;
  const roofHeight = parseLength(tags['roof:height']);
  if (roofHeight !== undefined && (out.height === undefined || roofHeight < out.height))
    roof.height = roofHeight;
  const roofLevels = parseLevels(tags['roof:levels']);
  if (roofLevels !== undefined) roof.levels = roofLevels;
  const direction = parseDirection(tags['roof:direction']);
  if (direction !== undefined) roof.direction = direction;
  const ridge = parseRidge(tags['roof:orientation']);
  if (ridge) roof.ridge = ridge;
  const roofColour = tagValue(tags, 'roof:colour');
  if (roofColour) roof.colour = roofColour;
  if (Object.keys(roof).length > 0) out.roof = roof;

  const wall = tagValue(tags, 'building:colour');
  if (wall) out.colours = { wall };

  const year = parseYear(tags.start_date);
  if (year !== undefined) out.year = year;
  return out;
}

/** Best guess of the total height from tags alone, for neighbour inputs. */
export function estimateHeight(a: Attributes): number | undefined {
  if (a.height !== undefined) return a.height;
  if (a.rawLevels === undefined) return undefined;
  const roof = a.roof?.height ?? (a.roof?.levels ?? 0) * NOMINAL_ROOF_LEVEL;
  return a.rawLevels * NOMINAL_LEVEL + roof;
}

/** `PartInput` from a part's footprint and tags. */
export function partInput(footprint: Polygon, a: Attributes): PartInput {
  const part: PartInput = { footprint };
  if (a.height !== undefined) part.height = a.height;
  // Parts carry minLevel themselves; only pass a tagged min_height.
  if (a.minHeight !== undefined && !a.minHeightFromLevels) part.minHeight = a.minHeight;
  if (a.rawLevels !== undefined) part.levels = a.rawLevels;
  if (a.minLevel !== undefined) part.minLevel = a.minLevel;
  if (a.roof) part.roof = a.roof;
  if (a.colours) part.colours = a.colours;
  return part;
}
