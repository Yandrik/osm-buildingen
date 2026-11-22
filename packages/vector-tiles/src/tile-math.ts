import type { LatLon, LatLonBBox } from '@osm-buildingen/osm';

/*
 * Web Mercator (EPSG:3857) tile maths, XYZ scheme (y = 0 at the north edge).
 * "World units" are tile units at one zoom: x = tileX × extent + px, and
 * yDown = tileY × extent + py. They are exact integers for every vertex of every
 * tile at that zoom, so geometry from neighbouring tiles lines up exactly.
 */

const RAD = Math.PI / 180;
/** Web Mercator stops here so the world is square. */
export const MAX_LATITUDE = 85.0511287798066;

export interface TileAddress {
  z: number;
  x: number;
  y: number;
}

/** Fractional tile x at zoom z. */
export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

/** Fractional tile y at zoom z (grows southwards). */
export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const s = Math.sin(clamped * RAD);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return Math.atan(Math.sinh(n)) / RAD;
}

/** lat/lon of a point given in world units (see above) at zoom z with the given extent. */
export function worldToLatLon(x: number, yDown: number, z: number, extent: number): LatLon {
  return { lat: tileYToLat(yDown / extent, z), lon: tileXToLon(x / extent, z) };
}

/** Bounding box of one tile. */
export function tileBBox(t: TileAddress): LatLonBBox {
  return {
    minLat: tileYToLat(t.y + 1, t.z),
    maxLat: tileYToLat(t.y, t.z),
    minLon: tileXToLon(t.x, t.z),
    maxLon: tileXToLon(t.x + 1, t.z),
  };
}

/**
 * Tiles at zoom z that intersect the bounding box, row by row from the north-west.
 * Does not handle boxes crossing the antimeridian.
 */
export function tilesForBBox(bbox: LatLonBBox, z: number): TileAddress[] {
  const n = 2 ** z;
  const clampTile = (v: number): number => Math.max(0, Math.min(n - 1, Math.floor(v)));
  const x0 = clampTile(lonToTileX(bbox.minLon, z));
  const x1 = clampTile(lonToTileX(bbox.maxLon, z));
  const y0 = clampTile(latToTileY(bbox.maxLat, z));
  const y1 = clampTile(latToTileY(bbox.minLat, z));
  const out: TileAddress[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

/**
 * Ground size of one tile unit in metres at a latitude, measured like the local
 * projection of `buildInputsFromTiles` (mean earth radius; Web Mercator itself
 * uses the equatorial radius, 0.11 % larger).
 */
export function unitSize(lat: number, z: number, extent = 4096): number {
  const circumference = 2 * Math.PI * 6371008.8;
  return (circumference / 2 ** z / extent) * Math.cos(lat * RAD);
}

export const tileKey = (t: TileAddress): string => `${t.z}/${t.x}/${t.y}`;
