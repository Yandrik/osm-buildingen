import type { Colour } from './colour';
import type { OrientedBox, Polygon } from './geom/polygon';
import type { Vec2 } from './geom/vec2';
import type { TileRole } from './styles/types';

export type { Polygon, Ring } from './geom/polygon';
export type { Vec2 } from './geom/vec2';

/** Point in output space: X = east, Y = up, Z = south. */
export type Vec3 = readonly [number, number, number];

export const BUILDING_TYPES = [
  'house',
  'apartments',
  'townhouse',
  'garage',
  'shed',
  'office',
  'skyscraper',
  'industrial',
  'station',
  'store',
  /** Roof on posts, no walls (OSM building=roof, carports, shelters, fuel-station canopies). */
  'canopy',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const ROOF_SHAPES = [
  'flat',
  'gabled',
  'hipped',
  'half-hipped',
  'pyramidal',
  'skillion',
  'gambrel',
  'mansard',
  'dome',
  'onion',
  'cone',
  'round',
  'sawtooth',
] as const;
export type RoofShape = (typeof ROOF_SHAPES)[number];

export type Region = 'de' | 'us';

export interface RoofInput {
  shape?: RoofShape;
  /** Height of the roof above the eave, metres. */
  height?: number;
  /** Levels inside the roof; used for the height when `height` is missing. */
  levels?: number;
  /** Compass bearing in degrees the roof faces (downslope). Used by skillion roofs. */
  direction?: number;
  /** Ridge along the long side (default) or across it. */
  ridge?: 'along' | 'across';
  /** Eave overhang in metres. Default: from the style. */
  overhang?: number;
  colour?: string;
}

export interface ColourInput {
  wall?: string;
  roof?: string;
  trim?: string;
  door?: string;
}

/**
 * A sub-volume of a building with its own height and roof (OSM `building:part`).
 * When a building has parts, only the parts are built; the outline is not.
 */
export interface PartInput {
  footprint: Polygon;
  height?: number;
  minHeight?: number;
  /** Levels counted from the ground, like OSM `building:levels`. */
  levels?: number;
  /** Levels skipped below the part, like OSM `building:min_level`. */
  minLevel?: number;
  roof?: RoofInput;
  colours?: ColourInput;
  /** Facade variant of the style pack for this part instead of the building's (see BuildingInput). */
  facadeVariant?: string;
}

export interface NeighbourInput {
  footprint: Polygon;
  /** Total height in metres, if known. Unknown heights block the full wall. */
  height?: number;
  /** Height at which the neighbour starts (a part that bridges over something). */
  minHeight?: number;
  /** True when the neighbour belongs to the same plot (garage next to its house). */
  sameGroup?: boolean;
}

export interface RoadInput {
  line: readonly Vec2[];
  /** Carriageway width in metres. */
  width?: number;
  kind?: 'road' | 'path' | 'rail';
  /** True when the road is known to pass through the building. */
  passage?: boolean;
}

export interface StyleInput {
  region: Region;
  /** 0 = old, 1 = new. Centre of the era distribution. */
  modernity: number;
  /** Id of a registered style pack. Defaults to the region's built-in pack. */
  pack?: string;
}

export interface BuildingInput {
  footprint: Polygon;
  parts?: readonly PartInput[];
  type?: BuildingType;
  /** Total height including the roof, metres above the ground (like OSM `height`). */
  height?: number;
  /** Above-ground levels, not counting levels inside the roof. */
  levels?: number;
  minHeight?: number;
  roof?: RoofInput;
  colours?: ColourInput;
  /** Construction year; overrides the era roll. */
  year?: number;
  /** Classification hint: buildings with an address are main buildings. */
  hasAddress?: boolean;
  /** Force (true) or forbid (false) a ground-floor store where the type allows one. */
  shop?: boolean;
  /** Probability of a ground-floor store for townhouses when `shop` is not set. */
  shopProbability?: number;
  /** Set to false for a building without an entrance door (default true). */
  entrance?: boolean;
  /**
   * Facade variant of the style pack (for example 'curtain' for offices) instead of a
   * rolled one. Ignored when no tile of the type uses that variant.
   */
  facadeVariant?: string;
  neighbours?: readonly NeighbourInput[];
  roads?: readonly RoadInput[];
  /** Buildings with the same key share era and palette. */
  groupKey?: string;
  style: StyleInput;
  seed: string | number;
  /** Added to every output height. */
  baseElevation?: number;
  detail?: 'massing' | 'full';
  /** Attach intermediate stage results to the output. */
  debug?: boolean;
}

export class BuildingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildingInputError';
  }
}

// ---------------------------------------------------------------------------
// Stage results
// ---------------------------------------------------------------------------

export interface Palette {
  wall: Colour;
  /** Plinth / base band. */
  base: Colour;
  roof: Colour;
  trim: Colour;
  door: Colour;
  glass: Colour;
  frame: Colour;
  accent: Colour;
  timber: Colour;
}

export type WallStyle = 'plain' | 'timber' | 'brick' | 'siding' | 'metal' | 'glass';

export interface FootprintMetrics {
  area: number;
  perimeter: number;
  box: OrientedBox;
  /** Footprint area divided by the oriented box area, 0..1. */
  rectangularity: number;
}

export interface ResolvedRoof {
  shape: RoofShape;
  /** Height above the eave. 0 for flat roofs. */
  height: number;
  /** Unit vector along the ridge. */
  ridgeAxis: Vec2;
  /** Unit vector pointing downslope (skillion). */
  slopeDirection: Vec2;
  overhang: number;
  /** Parapet height for flat roofs. */
  parapet: number;
}

export interface ResolvedSpec {
  type: BuildingType;
  packId: string;
  region: Region;
  /** 0 = old, 1 = new. */
  era: number;
  footprint: { outer: Vec2[]; holes: Vec2[][] };
  metrics: FootprintMetrics;
  /** Height of the wall base above the ground (min_height). */
  base: number;
  /** Height of each level, bottom to top. */
  levelHeights: number[];
  /** Sum of levelHeights. */
  wallHeight: number;
  roof: ResolvedRoof;
  palette: Palette;
  wallStyle: WallStyle;
  /** First level (0 = ground) that uses `wallStyle`; lower levels are plain. */
  wallStyleFromLevel: number;
  /** Building-wide facade variant from the style pack ('' when the type has none). */
  facadeVariant: string;
  /** Probability-rolled flag: mirror the street wall around its centre. */
  symmetric: boolean;
  /** A garage door sits at one end of the street wall (US houses). */
  attachedGarage: boolean;
  /** Ground floor store. */
  shop: boolean;
  bayWidth: number;
  plinthHeight: number;
  /** Things the generator decided or fell back to, for debugging. */
  notes: string[];
}

/** Piecewise-linear top edge of a wall: t along the wall (0..1) and height above the eave. */
export interface TopProfilePoint {
  t: number;
  h: number;
}

export interface WallSegment {
  /** Footprint edge. Seen from outside, `a` is on the left and `b` on the right. */
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit vector a -> b. */
  dir: Vec2;
  /** Unit outward normal. */
  normal: Vec2;
  /** 0 = outer ring, 1.. = holes. */
  ring: number;
  index: number;
  /** Extra wall above the eave line (gable ends, skillion sides). Empty for level tops. */
  top: TopProfilePoint[];
}

export interface RoofFace {
  /** Planar polygon, counter-clockwise seen from above. Heights are absolute within the building (above ground). */
  points: Vec3In[];
  /** Holes (clockwise), only used by flat roofs over courtyards. */
  holes?: Vec3In[][];
  /** `curved` faces approximate a curved surface (domes, barrel roofs); they get no dormers or chimneys. */
  kind: 'slope' | 'flat' | 'curved';
  /** Drawn in the glass colour instead of the roof colour (sawtooth glazing). */
  material?: 'glass';
}

export interface RoofGeometry {
  faces: RoofFace[];
  /**
   * Roof edge as a closed ring with heights, counter-clockwise. It lies outside the
   * walls by the overhang. Empty when the roof has no free edge to trim (flat roofs).
   */
  outline: Vec3In[];
  /** Roof surface height above the eave line at a footprint point. */
  heightAt(p: Vec2): number;
  /** Positions (0..1 along the wall) where the wall top changes slope. */
  breaks(wall: WallSegment): number[];
}

/** Footprint-space point with height: [east, north, height]. */
export type Vec3In = readonly [number, number, number];

export interface Span {
  /** Start and end along the wall, metres from `a`. */
  from: number;
  to: number;
  /** Height up to which the span applies (Infinity when unknown). */
  height: number;
  /** Height from which the span applies (0 unless the neighbour starts above the ground). */
  minHeight?: number;
}

export interface WallContext {
  /** A neighbour is closer than 1.5 m: no openings. */
  blocked: Span[];
  /** A neighbour touches the wall: party wall. */
  shared: Span[];
  /** 0..1, how much the wall faces the nearest road. */
  streetScore: number;
  /** Where a passage opens through the wall; `height` is the clear height of the opening. */
  passages: PassageSpan[];
  /** Fraction of the wall length that is not blocked. */
  openFraction: number;
  courtyard: boolean;
}

export interface FacadeCell {
  wall: number;
  column: number;
  row: number;
  /** Offset along the wall and above the wall base, metres. */
  x: number;
  y: number;
  width: number;
  height: number;
  blocked: boolean;
  /** Tile id from the style pack, or '#arch' for a passage cell. */
  tile: string;
  role: TileRole;
  /** Extra parameters for built-in tiles (the passage arch: `from`, `to`, `height` of its first opening). */
  params?: Record<string, number>;
  /** Passage openings in an '#arch' cell, in order along the wall. */
  openings?: FacadeOpening[];
}

/** One end of a passage where it meets a wall (see plan/pipeline/03-context.md, "Passages"). */
export interface PassageOpening {
  wall: number;
  /** The open stretch of this wall, metres from `a`. */
  from: number;
  to: number;
  /**
   * The whole opening measured along this wall's line. Equal to `from`/`to` unless the
   * opening continues around a corner onto the next wall; then it reaches beyond the
   * wall so that all walls of one opening share a single arch.
   */
  openFrom: number;
  openTo: number;
  /**
   * The space behind this end of the stretch is open beside it (oblique tunnel wall,
   * re-entrant corner), so the thickness of the wall above the arch needs a closing face.
   */
  capFrom: boolean;
  capTo: boolean;
}

/** A road corridor cut through the ground level of a building. */
export interface Passage {
  /** Floor outline of the tunnel: the road corridor inside the footprint. Counter-clockwise. */
  polygon: Vec2[];
  /** Building mass standing inside the corridor (clockwise rings); usually none. */
  holes: Vec2[][];
  /** Height of the tunnel ceiling above the wall base. */
  clearHeight: number;
  openings: PassageOpening[];
  /** Edges of the outline that get a tunnel wall; all others lie in an opening. */
  sides: [Vec2, Vec2][];
}

/** A passage opening on a wall as the facade stage sees it; `height` is the clear height. */
export interface PassageSpan extends Span {
  openFrom: number;
  openTo: number;
  capFrom: boolean;
  capTo: boolean;
  /** Plain rectangular hole up to the tunnel ceiling instead of an arch (party walls). */
  flat: boolean;
}

/** A passage opening inside one facade cell, in cell-local metres. */
export interface FacadeOpening {
  /** Edges of the whole opening; they may lie outside the cell when it spans several. */
  from: number;
  to: number;
  /** Clear height at the apex, which is also the height of the tunnel ceiling. */
  height: number;
  flat: boolean;
  /** The opening ends in this cell on its left / right, as far as this wall goes. */
  endFrom: boolean;
  endTo: boolean;
  /** Close the wall thickness at that end (see PassageOpening); only set together with the end. */
  capFrom: boolean;
  capTo: boolean;
}

export interface FacadeLayout {
  cells: FacadeCell[];
  /** Wall that got the entrance, or -1. */
  streetWall: number;
  /** Solver restarts that were needed. */
  attempts: number;
  /** True when the solver gave up and filled the rest with blank tiles. */
  fallback: boolean;
}

export interface BuildingDebug {
  spec: ResolvedSpec;
  walls: WallSegment[];
  context: WallContext[];
  facade: FacadeLayout | null;
  /** Road corridors cut through the ground level; empty for most buildings. */
  passages: Passage[];
  roofFaces: number;
  timings: Record<string, number>;
  /** For buildings made of parts: one entry per part; the fields above describe the entrance part. */
  parts?: BuildingDebug[];
}

export interface BuildingMesh {
  /** xyz per vertex. X = east, Y = up, Z = south. */
  positions: Float32Array;
  /** xyz per vertex, flat shaded. */
  normals: Float32Array;
  /** rgb per vertex, 0..255. */
  colors: Uint8Array;
  indices: Uint32Array;
  bounds: { min: Vec3; max: Vec3 };
  debug?: BuildingDebug;
}
