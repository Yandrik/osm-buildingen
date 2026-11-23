/** Flat colours for the cell-shaded ground. Lighting adds the bands, so these stay soft. */

export const GROUND = '#9cc56a';

export const LANDUSE: Record<string, string> = {
  forest: '#5a9444',
  wood: '#5a9444',
  grass: '#93c95e',
  park: '#8fcb62',
  garden: '#8fcb62',
  meadow: '#a9cf6c',
  village_green: '#93c95e',
  recreation_ground: '#93c95e',
  pitch: '#7fbf63',
  golf_course: '#8fcf6b',
  playground: '#b6d48a',
  stadium: '#c9c1b2',
  scrub: '#86a85a',
  heath: '#a3ad66',
  farmland: '#dccf82',
  farmyard: '#cfbf93',
  orchard: '#a4c66b',
  vineyard: '#b0c06a',
  allotments: '#b2cf7c',
  cemetery: '#a6c48f',
  residential: '#d8d0c0',
  commercial: '#dccbc0',
  retail: '#e0c9bd',
  industrial: '#c7bfb5',
  military: '#c4bca3',
  quarry: '#cbc3b5',
  nature_reserve: '',
  parking: '#bdbab5',
  beach: '#eedfa8',
};

export const BUILDING_FOOTPRINT = '#b3a594';
export const WATER = '#4aa6de';
export const WATER_EDGE = '#3a8cc2';

export interface RoadStyle {
  width: number;
  fill: string;
  casing: string;
  /** Painted after lower ranks. */
  rank: number;
  /** Centre line dashes at high texture resolution. */
  dashes?: boolean;
}

const ASPHALT = '#5d6168';
const ASPHALT_DARK = '#44474d';
const PATH = '#e9dcbc';
const PATH_EDGE = '#c4b38d';

export const ROADS: Record<string, RoadStyle> = {
  motorway: { width: 18, fill: '#575b62', casing: ASPHALT_DARK, rank: 9, dashes: true },
  trunk: { width: 15, fill: ASPHALT, casing: ASPHALT_DARK, rank: 8, dashes: true },
  primary: { width: 13, fill: ASPHALT, casing: ASPHALT_DARK, rank: 7, dashes: true },
  secondary: { width: 11, fill: ASPHALT, casing: ASPHALT_DARK, rank: 6, dashes: true },
  tertiary: { width: 9, fill: ASPHALT, casing: ASPHALT_DARK, rank: 5, dashes: true },
  motorway_link: { width: 8, fill: '#575b62', casing: ASPHALT_DARK, rank: 9 },
  trunk_link: { width: 8, fill: ASPHALT, casing: ASPHALT_DARK, rank: 8 },
  primary_link: { width: 8, fill: ASPHALT, casing: ASPHALT_DARK, rank: 7 },
  secondary_link: { width: 7, fill: ASPHALT, casing: ASPHALT_DARK, rank: 6 },
  tertiary_link: { width: 7, fill: ASPHALT, casing: ASPHALT_DARK, rank: 5 },
  residential: { width: 7.5, fill: '#686c72', casing: ASPHALT_DARK, rank: 4 },
  unclassified: { width: 7, fill: '#686c72', casing: ASPHALT_DARK, rank: 4 },
  living_street: { width: 6, fill: '#7b7d80', casing: ASPHALT_DARK, rank: 3 },
  road: { width: 6, fill: '#686c72', casing: ASPHALT_DARK, rank: 3 },
  service: { width: 4.5, fill: '#72767b', casing: ASPHALT_DARK, rank: 2 },
  pedestrian: { width: 6, fill: '#d8cfbf', casing: '#b4a994', rank: 2 },
  busway: { width: 6, fill: '#7a5b5b', casing: ASPHALT_DARK, rank: 3 },
  track: { width: 3, fill: '#bf9f6e', casing: '#9c7f55', rank: 1 },
  track_grade1: { width: 3.5, fill: '#a99c86', casing: '#8a7d66', rank: 1 },
  track_grade2: { width: 3, fill: '#bf9f6e', casing: '#9c7f55', rank: 1 },
  track_grade3: { width: 3, fill: '#bf9f6e', casing: '#9c7f55', rank: 1 },
  track_grade4: { width: 2.5, fill: '#bf9f6e', casing: '#9c7f55', rank: 1 },
  track_grade5: { width: 2.5, fill: '#bf9f6e', casing: '#9c7f55', rank: 1 },
  cycleway: { width: 2.2, fill: '#8fb0c9', casing: '#6b8ca6', rank: 1 },
  footway: { width: 2, fill: PATH, casing: PATH_EDGE, rank: 0 },
  path: { width: 1.8, fill: PATH, casing: PATH_EDGE, rank: 0 },
  steps: { width: 2.2, fill: '#cfc3a8', casing: PATH_EDGE, rank: 0 },
  bridleway: { width: 2, fill: PATH, casing: PATH_EDGE, rank: 0 },
};

export const DEFAULT_ROAD: RoadStyle = { width: 5, fill: '#72767b', casing: ASPHALT_DARK, rank: 2 };

export function roadStyle(fclass: string): RoadStyle {
  return ROADS[fclass] ?? DEFAULT_ROAD;
}

export const RAIL = { width: 3, fill: '#8a7f75', casing: '#5f5750' };

export const WATERWAY_WIDTH: Record<string, number> = {
  river: 25,
  canal: 12,
  stream: 3,
  drain: 1.5,
  ditch: 1.2,
};
