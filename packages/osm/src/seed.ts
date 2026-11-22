import { seedFrom } from '@osm-buildingen/core';
import { EARTH_RADIUS } from './projection';
import type { OsmNode, Tags } from './types';

/** Tags that change what core generates; their values go into the seed. */
export const SEED_TAGS: readonly string[] = [
  'amenity',
  'building',
  'building:colour',
  'building:levels',
  'building:min_level',
  'height',
  'historic',
  'man_made',
  'min_height',
  'office',
  'roof:colour',
  'roof:direction',
  'roof:height',
  'roof:levels',
  'roof:orientation',
  'roof:shape',
  'shop',
  'start_date',
];

const RAD = Math.PI / 180;
/** Footprint quantisation for the seed, metres. */
const QUANTUM = 0.1;

/**
 * Ring as text, independent of the map origin, the ring's start vertex
 * and its winding: vertices in metres relative to the outer ring's lat/lon mean,
 * quantised to 10 cm, counter-clockwise, starting at the smallest point.
 */
function ringKey(ll: readonly OsmNode[], lat0: number, lon0: number): string {
  const ky = (EARTH_RADIUS * RAD) / QUANTUM;
  const kx = ky * Math.cos(lat0 * RAD);
  let pts: [number, number][] = [];
  for (const n of ll) {
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
  const ordered = pts.slice(start).concat(pts.slice(0, start));
  return ordered.map((p) => `${p[0]},${p[1]}`).join(';');
}

/**
 * Stable building seed from the global seed, the footprint's position and
 * shape, and the generation-relevant tags. Not the OSM id, so re-imports, id
 * changes and differently cut extracts keep the look.
 */
export function buildingSeed(
  globalSeed: string | number,
  shape: { outerIds: readonly number[]; holeIds: readonly (readonly number[])[]; tags: Tags },
  nodes: ReadonlyMap<number, OsmNode>,
): number {
  const lookup = (ids: readonly number[]): OsmNode[] => {
    const out: OsmNode[] = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (n) out.push(n);
    }
    return out;
  };
  const outer = lookup(shape.outerIds);
  let lat0 = 0;
  let lon0 = 0;
  for (const n of outer) {
    lat0 += n.lat;
    lon0 += n.lon;
  }
  lat0 /= outer.length || 1;
  lon0 /= outer.length || 1;
  const holes = shape.holeIds.map((h) => ringKey(lookup(h), lat0, lon0)).sort();
  const footprint = [ringKey(outer, lat0, lon0), ...holes].join('|');
  let tags = '';
  for (const k of SEED_TAGS) {
    const v = shape.tags[k];
    if (v !== undefined) tags += `${k}=${v}\n`;
  }
  // Absolute position (about 0.1 m, from lat/lon so it does not depend on the origin):
  // identical prefab houses in a row must not get identical seeds.
  const position = `${Math.round(lat0 * 1e6)},${Math.round(lon0 * 1e6)}`;
  return seedFrom(globalSeed, position, footprint, tags);
}
