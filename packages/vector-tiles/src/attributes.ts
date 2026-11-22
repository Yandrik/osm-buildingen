import type { ColourInput, PartInput, Polygon } from '@osm-buildingen/core';
import type { PropertyValue } from './mvt';

/*
 * OpenMapTiles `building` properties -> dimensions.
 *
 * The schema computes (openmaptiles layers/building/building.sql, and the same
 * in planetiler-openmaptiles Building.java):
 *   render_height     = ceil(height ?? levels × 3.66 ?? 5)
 *   render_min_height = floor(min_height ?? min_level × 3.66 ?? 0)
 * so 5 / 0 means "nothing tagged", and heights that equal ceil(n × 3.66) are
 * most likely `building:levels = n`. Levels are the better input: OSM `height`
 * includes the roof, levels do not, and core adds a roof on top of levels.
 */

/** Level height the schema uses to turn levels into metres. */
export const SCHEMA_LEVEL = 3.66;
/** `render_height` the schema writes when neither height nor levels are tagged. */
export const DEFAULT_RENDER_HEIGHT = 5;
const MAX_LEVELS = 200;

export type HeightSource = 'levels' | 'height' | 'default';

export interface VectorAttributes {
  /** Total height in metres (only when not read as levels). */
  height?: number;
  minHeight?: number;
  /** Levels above the base (building semantics: minimum levels already subtracted). */
  levels?: number;
  /** Levels counted from the ground and skipped below, for parts (S3DB semantics). */
  rawLevels?: number;
  minLevel?: number;
  colours?: ColourInput;
  heightSource: HeightSource;
  /** Height estimate for neighbours; undefined when unknown. */
  estimate?: number;
}

const num = (v: PropertyValue | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** n when `value` equals ceil(n × 3.66) (or floor for minimum heights), else undefined. */
export function levelsFromSchemaHeight(value: number, round: 'ceil' | 'floor'): number | undefined {
  const guess = Math.round(value / SCHEMA_LEVEL);
  for (const n of [guess - 1, guess, guess + 1]) {
    if (n < 1 || n > MAX_LEVELS) continue;
    const v = round === 'ceil' ? Math.ceil(n * SCHEMA_LEVEL) : Math.floor(n * SCHEMA_LEVEL);
    if (v === value) return n;
  }
  return undefined;
}

/**
 * Reads `render_height`, `render_min_height` and `colour`. With `levelsHeuristic`
 * (default), heights that match the schema's levels formula become levels.
 */
export function readAttributes(
  props: Record<string, PropertyValue>,
  levelsHeuristic = true,
): VectorAttributes {
  const rh = num(props.render_height);
  const rmhRaw = num(props.render_min_height) ?? 0;
  const out: VectorAttributes = { heightSource: 'default' };
  const colour = props.colour;
  if (typeof colour === 'string' && colour !== '') out.colours = { wall: colour };
  if (rh === undefined || rh <= 0) return out;
  const rmh = rmhRaw > 0 && rmhRaw < rh ? rmhRaw : 0;
  if (rh === DEFAULT_RENDER_HEIGHT && rmh === 0) return out;
  out.estimate = rh;
  if (rmh > 0) out.minHeight = rmh;

  const n = levelsHeuristic ? levelsFromSchemaHeight(rh, 'ceil') : undefined;
  const m = rmh > 0 && levelsHeuristic ? levelsFromSchemaHeight(rmh, 'floor') : 0;
  if (n !== undefined && m !== undefined && n - m >= 1) {
    out.heightSource = 'levels';
    out.levels = n - m;
    out.rawLevels = n;
    if (m > 0) out.minLevel = m;
  } else {
    out.heightSource = 'height';
    out.height = rh;
  }
  return out;
}

/** `PartInput` for a `building:part` polygon. Parts use S3DB levels (from the ground, minLevel skipped). */
export function partInput(footprint: Polygon, a: VectorAttributes): PartInput {
  const part: PartInput = { footprint };
  if (a.heightSource === 'levels') {
    if (a.rawLevels !== undefined) part.levels = a.rawLevels;
    if (a.minLevel !== undefined) part.minLevel = a.minLevel;
  } else {
    if (a.height !== undefined) part.height = a.height;
    if (a.minHeight !== undefined) part.minHeight = a.minHeight;
  }
  if (a.colours) part.colours = a.colours;
  return part;
}
