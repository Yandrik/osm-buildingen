import type { Vec2 } from '@osm-buildingen/core';
import type { LatLon } from './types';

/** Mean earth radius (IUGG), metres. */
export const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

/**
 * Local equirectangular projection around an origin: x = metres east,
 * y = metres north. Distortion stays below 0.1 % within ~10 km of the origin,
 * which is plenty for a town.
 */
export interface Projection {
  origin: LatLon;
  project(lat: number, lon: number): Vec2;
  unproject(x: number, y: number): LatLon;
}

/** Creates the projection used by `buildInputs` for a given origin. */
export function createProjection(origin: LatLon): Projection {
  const ky = EARTH_RADIUS * RAD;
  const kx = ky * Math.cos(origin.lat * RAD);
  return {
    origin: { lat: origin.lat, lon: origin.lon },
    project: (lat, lon) => [(lon - origin.lon) * kx, (lat - origin.lat) * ky],
    unproject: (x, y) => ({ lat: origin.lat + y / ky, lon: origin.lon + x / kx }),
  };
}

/** lat/lon -> local metres `[east, north]` around `origin`. */
export function project(point: LatLon, origin: LatLon): Vec2 {
  return createProjection(origin).project(point.lat, point.lon);
}

/** Local metres `[east, north]` around `origin` -> lat/lon. */
export function unproject(point: Vec2, origin: LatLon): LatLon {
  return createProjection(origin).unproject(point[0], point[1]);
}
