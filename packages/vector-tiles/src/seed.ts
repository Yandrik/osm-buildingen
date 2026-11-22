import { seedFrom } from '@osm-buildingen/core';
import type { LatLon } from '@osm-buildingen/osm';
import type { PropertyValue } from './mvt';

/*
 * Building seeds, the same scheme as the OSM adapter (packages/osm/src/seed.ts,
 * copied because it is internal there): footprint vertices in metres relative
 * to the outer ring's lat/lon mean, quantised to 10 cm, counter-clockwise from
 * the smallest point; plus that mean in 1e-6 degrees and the properties that
 * change the output. Computed from lat/lon, so it depends neither on the origin
 * nor on which tile a piece came from or the feature order; only the stitched
 * geometry counts. Not equal to the OSM adapter's seed for the same building:
 * tile geometry is quantised to tile units and simplified.
 */

/** Same radius as the OSM adapter's projection. */
const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const QUANTUM = 0.1;

/** Properties that change what is generated; their values go into the seed. */
export const SEED_PROPERTIES: readonly string[] = ['colour', 'hide_3d', 'render_height', 'render_min_height'];

function ringKey(ring: readonly LatLon[], lat0: number, lon0: number): string {
  const ky = (EARTH_RADIUS * RAD) / QUANTUM;
  const kx = ky * Math.cos(lat0 * RAD);
  let pts: [number, number][] = [];
  for (const n of ring) {
    const p: [number, number] = [Math.round((n.lon - lon0) * kx), Math.round((n.lat - lat0) * ky)];
    const last = pts[pts.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    pts.push(p);
  }
  while (pts.length > 1) {
    const first = pts[0] as [number, number];
    const last = pts[pts.length - 1] as [number, number];
    if (first[0] !== last[0] || first[1] !== last[1]) break;
    pts.pop();
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    const q = pts[(i + 1) % pts.length] as [number, number];
    area += p[0] * q[1] - q[0] * p[1];
  }
  if (area < 0) pts = pts.reverse();
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    const s = pts[start] as [number, number];
    if (p[0] < s[0] || (p[0] === s[0] && p[1] < s[1])) start = i;
  }
  return pts
    .slice(start)
    .concat(pts.slice(0, start))
    .map((p) => `${p[0]},${p[1]}`)
    .join(';');
}

/** Stable seed from the global seed, the footprint (lat/lon rings) and the seed properties. */
export function vectorBuildingSeed(
  globalSeed: string | number,
  outer: readonly LatLon[],
  holes: readonly (readonly LatLon[])[],
  props: Record<string, PropertyValue>,
): number {
  let lat0 = 0;
  let lon0 = 0;
  for (const n of outer) {
    lat0 += n.lat;
    lon0 += n.lon;
  }
  lat0 /= outer.length || 1;
  lon0 /= outer.length || 1;
  const footprint = [ringKey(outer, lat0, lon0), ...holes.map((h) => ringKey(h, lat0, lon0)).sort()].join(
    '|',
  );
  let tags = '';
  for (const k of SEED_PROPERTIES) {
    const v = props[k];
    if (v !== undefined) tags += `${k}=${String(v)}\n`;
  }
  const position = `${Math.round(lat0 * 1e6)},${Math.round(lon0 * 1e6)}`;
  return seedFrom(globalSeed, position, footprint, tags);
}
