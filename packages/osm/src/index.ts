/**
 * OpenStreetMap adapter for `@osm-buildingen/core`: parse OSM data and turn it
 * into `BuildingInput[]`. Network access lives in `@osm-buildingen/osm/overpass`.
 */
export { parseOsmXml } from './xml';
export { parseOverpassJson } from './overpass-json';
export { buildInputs, GROUP_DISTANCE, NEIGHBOUR_DISTANCE, ROAD_DISTANCE } from './build';
export type { BuildOptions, BuildResult } from './build';
export { createProjection, project, unproject } from './projection';
export type { Projection } from './projection';
export { parseDirection, parseLength, parseLevels, parseRoofShape, parseYear } from './tags';
export type {
  BuildStats,
  BuildingMeta,
  LatLon,
  LatLonBBox,
  MapRoad,
  OsmData,
  OsmElementType,
  OsmMember,
  OsmNode,
  OsmRelation,
  OsmWay,
  Tags,
} from './types';
