import type { PropertyValue } from './mvt';

/*
 * OpenMapTiles `transportation` -> road kind and width. Widths follow the OSM
 * adapter's class defaults (packages/osm/src/roads.ts); the tiles carry no
 * `width` or `lanes`, and `*_link` roads are the base class with `ramp=1`.
 */

/** Width in metres by `class` for vehicle roads (kind 'road'). */
export const ROAD_WIDTH: Readonly<Record<string, number>> = {
  motorway: 20,
  trunk: 14,
  primary: 10,
  secondary: 8,
  tertiary: 7,
  minor: 6,
  busway: 6,
  service: 4,
  track: 3,
};
/** Width of `ramp=1` roads (OSM `*_link`). */
export const RAMP_WIDTH = 5;

/** Width by `subclass` for `class=path` (kind 'path'). `corridor` and `platform` are not paths outside. */
export const PATH_WIDTH: Readonly<Record<string, number>> = {
  pedestrian: 6,
  footway: 2,
  cycleway: 2,
  steps: 2,
  bridleway: 2,
  path: 1.5,
};

/** Width by `subclass` for `class=rail` and `class=transit` (kind 'rail'). */
export const RAIL_WIDTH: Readonly<Record<string, number>> = {
  rail: 3.5,
  light_rail: 3,
  narrow_gauge: 3,
  tram: 2.5,
};

export interface VectorRoadClass {
  kind: 'road' | 'path' | 'rail';
  /** `class`, or `class/subclass` for paths and rail. */
  class: string;
  width: number;
  /** `brunnel` value: bridges never count as passages through a building. */
  brunnel: string | undefined;
}

/**
 * Classifies a `transportation` feature, or returns undefined when it does not face
 * facades: construction, ferries, piers, aerialways, platforms, indoor ways,
 * negative layers and tunnels below ground. A tunnel on layer 0 is kept, because
 * OSM `tunnel=building_passage` arrives as `brunnel=tunnel` too.
 */
export function vectorRoadClass(props: Record<string, PropertyValue>): VectorRoadClass | undefined {
  const cls = typeof props.class === 'string' ? props.class : undefined;
  if (!cls) return undefined;
  const subclass = typeof props.subclass === 'string' ? props.subclass : '';
  const layer = typeof props.layer === 'number' ? props.layer : Number(props.layer ?? 0) || 0;
  const brunnel = typeof props.brunnel === 'string' ? props.brunnel : undefined;
  if (props.indoor === 1 || props.indoor === true || layer < 0) return undefined;
  let width: number | undefined;
  let kind: VectorRoadClass['kind'];
  let name = cls;
  if ((width = ROAD_WIDTH[cls]) !== undefined) {
    kind = 'road';
    if (props.ramp === 1 || props.ramp === true) width = Math.min(width, RAMP_WIDTH);
  } else if (cls === 'path' && (width = PATH_WIDTH[subclass]) !== undefined) {
    kind = 'path';
    name = `path/${subclass}`;
  } else if ((cls === 'rail' || cls === 'transit') && (width = RAIL_WIDTH[subclass]) !== undefined) {
    kind = 'rail';
    name = `${cls}/${subclass}`;
  } else return undefined;
  return { kind, class: name, width, brunnel };
}
