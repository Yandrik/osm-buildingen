/**
 * World frame shared by terrain, OSM tiles and physics.
 *
 * The OSM tiles use a uniformly scaled Web Mercator (see data/osm/README.md): every z14 tile is
 * the same square of TILE metres, so Mapterhorn's z14 terrain tiles line up with them exactly.
 * World coordinates: e = east, n = north, metres, origin at the SW corner of tile (X0, Y0).
 * three.js: X = e, Y = up, Z = -n.
 */

export const ZOOM = 14;
export const TILE = 1608.9;
/** Tile column / row of the world origin (west-most column, south-most row of the data). */
export const X0 = 8276;
export const Y0 = 5650;
export const X1 = 8322;
export const Y1 = 5620;
/** Building cells per tile side: 8 -> about 201 m cells. */
export const CELLS = 8;
export const CELL = TILE / CELLS;

const R = 6378137;
const TILE_MERC = (2 * Math.PI * R) / 2 ** ZOOM;
const K = TILE / TILE_MERC;
const MERC_WEST = -Math.PI * R + X0 * TILE_MERC;
const MERC_SOUTH = Math.PI * R - (Y0 + 1) * TILE_MERC;

export const BBOX = { west: 1.8621, south: 48.6478, east: 2.8612, north: 49.0936 };

export function lonLatToWorld(lon: number, lat: number): { e: number; n: number } {
  const mx = (R * lon * Math.PI) / 180;
  const my = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { e: (mx - MERC_WEST) * K, n: (my - MERC_SOUTH) * K };
}

export function worldToLonLat(e: number, n: number): { lon: number; lat: number } {
  const mx = e / K + MERC_WEST;
  const my = n / K + MERC_SOUTH;
  return {
    lon: ((mx / R) * 180) / Math.PI,
    lat: ((2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180) / Math.PI,
  };
}

/** South-west corner of a z14 tile in world metres. */
export function tileOrigin(tx: number, ty: number): { e: number; n: number } {
  return { e: (tx - X0) * TILE, n: (Y0 - ty) * TILE };
}

export function tileAt(e: number, n: number): { tx: number; ty: number } {
  return { tx: X0 + Math.floor(e / TILE), ty: Y0 - Math.floor(n / TILE) };
}

/** South-west corner and size of any slippy tile at zoom <= 14, in world metres. */
export function slippyRect(z: number, x: number, y: number): { e: number; n: number; size: number } {
  const s = 2 ** (ZOOM - z);
  return { e: (x * s - X0) * TILE, n: (Y0 - ((y + 1) * s - 1)) * TILE, size: s * TILE };
}

export function inData(tx: number, ty: number): boolean {
  return tx >= X0 && tx <= X1 && ty >= Y1 && ty <= Y0;
}

export const tileKey = (tx: number, ty: number): string => `${tx}/${ty}`;
