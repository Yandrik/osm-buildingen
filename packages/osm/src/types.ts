import type { RoadInput, Vec2 } from '@osm-buildingen/core';

/** OSM tags. Objects are created without a prototype so keys like `__proto__` are plain data. */
export type Tags = Record<string, string>;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LatLonBBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  /** Only present when the node has tags. */
  tags?: Tags;
}

export interface OsmWay {
  id: number;
  /** Node ids in order. Closed ways repeat the first id at the end. */
  nodes: number[];
  tags: Tags;
}

export interface OsmMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OsmRelation {
  id: number;
  members: OsmMember[];
  tags: Tags;
}

/**
 * Parsed OSM data. Plain arrays and objects, so it can be posted to a worker or
 * serialised as JSON. Element order carries no meaning.
 */
export interface OsmData {
  /** From the `<bounds>` element or the Overpass `bounds` field, when present. */
  bounds?: LatLonBBox;
  nodes: OsmNode[];
  ways: OsmWay[];
  relations: OsmRelation[];
}

export type OsmElementType = 'way' | 'relation';

/** Everything the adapter knows about one produced input; `meta[i]` belongs to `inputs[i]`. */
export interface BuildingMeta {
  osmType: OsmElementType;
  osmId: number;
  /**
   * Outer ring index for multipolygons with several outer rings (each ring is
   * its own building). Always 0 for ways.
   */
  ring: number;
  tags: Tags;
  /** Footprint centroid in local metres (same frame as the input). */
  centroid: Vec2;
  centroidLatLon: LatLon;
  /** Footprint area in m², holes subtracted. */
  area: number;
  /** Church, tower, castle, …: emitted with `detail: 'massing'`. */
  special: boolean;
  /** Type the adapter chose, undefined when core should guess. */
  type: string | undefined;
  /** Short explanation of the type choice, e.g. `building=retail` or `shop node, 4 levels`. */
  typeReason: string;
  groupKey: string;
  /** OSM ids of the `building:part` ways/relations attached as parts. */
  partIds: number[];
}

/** A highway or railway line in local metres, for drawing the map around the buildings. */
export interface MapRoad extends RoadInput {
  osmId: number;
  line: Vec2[];
  width: number;
  kind: 'road' | 'path' | 'rail';
  /** The `highway` or `railway` value. */
  class: string;
}

export interface BuildStats {
  /** Building elements that could not be built (missing nodes, open rings, tiny area). */
  skippedIncomplete: number;
  /** Buildings outside the `bbox` option. */
  skippedOutside: number;
  /** `building=no`, construction, underground, … */
  skippedByTag: number;
  /** `building:part` elements not inside any building. */
  orphanParts: number;
}
