import { parseLength, parseLevels } from './tags';
import type { Tags } from './types';

/*
 * Which OSM ways count as roads, and how wide they are. Width precedence:
 * `width` tag > `lanes` × LANE_WIDTH > class default below.
 */

export const LANE_WIDTH = 3;

/** Carriageway width in metres by `highway=*` value; also defines which values are vehicle roads. */
export const ROAD_WIDTH: Readonly<Record<string, number>> = {
  motorway: 20,
  trunk: 14,
  primary: 10,
  secondary: 8,
  tertiary: 7,
  motorway_link: 5,
  trunk_link: 5,
  primary_link: 5,
  secondary_link: 5,
  tertiary_link: 5,
  unclassified: 6,
  residential: 6,
  road: 6,
  busway: 6,
  living_street: 5,
  service: 4,
  track: 3,
};

/** Width by `highway=*` value for paths (kind 'path'). */
export const PATH_WIDTH: Readonly<Record<string, number>> = {
  pedestrian: 6,
  footway: 2,
  cycleway: 2,
  path: 1.5,
  steps: 2,
  bridleway: 2,
};

/** Width by `railway=*` value (kind 'rail'), roughly the track bed. */
export const RAIL_WIDTH: Readonly<Record<string, number>> = {
  rail: 3.5,
  light_rail: 3,
  tram: 2.5,
  narrow_gauge: 3,
};

export interface RoadClass {
  kind: 'road' | 'path' | 'rail';
  class: string;
  width: number;
  /** `tunnel=building_passage`. */
  passage: boolean;
}

/**
 * Classifies a way as road, path or rail, or returns undefined when it is not
 * one (areas, indoor ways, negative layers, proposed, under construction,
 * platforms, tunnels other than building passages, unknown values such as
 * `corridor`).
 */
export function roadClass(tags: Tags): RoadClass | undefined {
  if (tags.area === 'yes' || tags.indoor === 'yes') return undefined;
  // Underground ways (underpasses, U-Bahn) do not face any facade.
  const layer = Number(tags.layer ?? 0);
  if (layer < 0) return undefined;
  const tunnel = tags.tunnel;
  const passage = tunnel === 'building_passage';
  if (tunnel !== undefined && tunnel !== 'no' && !passage) return undefined;

  const h = tags.highway;
  let kind: RoadClass['kind'];
  let base: number | undefined;
  let cls: string;
  if (h !== undefined) {
    cls = h;
    if ((base = ROAD_WIDTH[h]) !== undefined) kind = 'road';
    else if ((base = PATH_WIDTH[h]) !== undefined) kind = 'path';
    else return undefined;
  } else {
    const r = tags.railway;
    if (r === undefined || (base = RAIL_WIDTH[r]) === undefined) return undefined;
    cls = r;
    kind = 'rail';
  }

  let width = parseLength(tags.width ?? tags.est_width);
  if (width === undefined && kind === 'road') {
    const lanes = parseLevels(tags.lanes);
    if (lanes !== undefined && lanes > 0) width = lanes * LANE_WIDTH;
  }
  if (width === undefined || width <= 0 || width > 100) width = base;
  return { kind, class: cls, width, passage };
}
