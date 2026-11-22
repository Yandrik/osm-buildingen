/**
 * Vector tile adapter for `@osm-buildingen/core`: decode Mapbox Vector Tiles in
 * the OpenMapTiles schema and turn them into `BuildingInput[]`. Network access
 * lives in `@osm-buildingen/vector-tiles/fetch`.
 */
export { decodeTile, featurePolygons, tileRingArea } from './mvt';
export type {
  DecodeOptions,
  DecodedTile,
  GeometryType,
  PropertyValue,
  TileFeature,
  TileLayer,
  TilePoint,
  TilePolygon,
} from './mvt';
export { PbfError } from './pbf';
export {
  buildInputsFromTiles,
  GROUP_DISTANCE,
  NEIGHBOUR_DISTANCE,
  OPENMAPTILES_LAYERS,
  ROAD_DISTANCE,
} from './build';
export type { LayerNames, VectorBuildOptions, VectorBuildResult } from './build';
export { levelsFromSchemaHeight } from './attributes';
export type { HeightSource } from './attributes';
export {
  latToTileY,
  lonToTileX,
  tileBBox,
  tileKey,
  tileXToLon,
  tileYToLat,
  tilesForBBox,
  unitSize,
  worldToLatLon,
} from './tile-math';
export type { TileAddress } from './tile-math';
export type { VectorBuildStats, VectorBuildingMeta, VectorRoad } from './types';
