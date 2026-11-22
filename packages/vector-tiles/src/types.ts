import type { RoadInput, Vec2 } from '@osm-buildingen/core';
import type { LatLon } from '@osm-buildingen/osm';
import type { HeightSource } from './attributes';
import type { PropertyValue } from './mvt';

/** Everything the adapter knows about one produced input; `meta[i]` belongs to `inputs[i]`. */
export interface VectorBuildingMeta {
  /** Stable identifier: base36 of the seed without the global seed. Survives re-fetches and other tile sets. */
  key: string;
  /** Properties of the `building` feature (render_height, render_min_height, colour, hide_3d). */
  properties: Record<string, PropertyValue>;
  /** MVT feature id when the polygon was alone in its feature. Generator-specific; not an OSM id in general. */
  featureId?: number;
  /** Tiles (`z/x/y`) the footprint was assembled from. */
  tiles: string[];
  /** Assembled from pieces of several tiles. */
  stitched: boolean;
  /** Cut at the buffer edge of the loaded tiles: the footprint is incomplete. */
  truncated: boolean;
  /** Footprint centroid in local metres (same frame as the input). */
  centroid: Vec2;
  centroidLatLon: LatLon;
  /** Footprint area in m², holes subtracted. */
  area: number;
  /** Place of worship, castle: emitted with `detail: 'massing'`. */
  special: boolean;
  /** Type the adapter chose, undefined when core should guess. */
  type: string | undefined;
  /** Short explanation of the type choice, e.g. `poi railway/station` or `no hint`. */
  typeReason: string;
  /** Where the height came from: `levels` (heuristic), `height`, or `default` (not tagged, left to core). */
  heightSource: HeightSource;
  groupKey: string;
  /** Number of `building:part` polygons attached as parts. */
  parts: number;
  /** House numbers found inside the footprint. */
  housenumbers: string[];
  /** POIs inside the footprint as `class/subclass`. */
  pois: string[];
  /** Class of the smallest landuse polygon containing the footprint, if any. */
  landuse: string | undefined;
}

/** A road, path or rail line in local metres, for drawing. */
export interface VectorRoad extends RoadInput {
  line: Vec2[];
  width: number;
  kind: 'road' | 'path' | 'rail';
  /** OpenMapTiles `class`, or `class/subclass` for paths and rail. */
  class: string;
  brunnel?: string;
}

export interface VectorBuildStats {
  tiles: number;
  zoom: number;
  /** Building polygons read from the tiles, before clipping and merging. */
  polygonsRead: number;
  /** Groups of pieces from several tiles merged into one footprint. */
  stitched: number;
  /** Footprints cut at the edge of the loaded tiles (still emitted when inside the bbox). */
  truncated: number;
  /** Footprints below the minimum area. */
  skippedTiny: number;
  /** Buildings outside the `bbox` option. */
  skippedOutside: number;
  /** Polygons attached to another one as `building:part`. */
  parts: number;
  /** Buildings whose `render_height` is the schema default (nothing tagged). */
  defaultHeight: number;
}
