/**
 * The viewer works with two adapters: OSM (`buildInputs`) and vector tiles
 * (`buildInputsFromTiles`). Their results share inputs, centroids, groups and
 * roads; this module holds the union type and the few source-specific helpers.
 */
import type { BuildResult, BuildingMeta } from '@osm-buildingen/osm';
import type { VectorBuildResult, VectorBuildingMeta } from '@osm-buildingen/vector-tiles';

export type AreaBuild = ({ source: 'osm' } & BuildResult) | ({ source: 'tiles' } & VectorBuildResult);
export type AreaMeta = BuildingMeta | VectorBuildingMeta;

export const isOsmMeta = (m: AreaMeta): m is BuildingMeta => 'osmId' in m;

/** Short label for lists: OSM element, or the tile building's stable key. */
export function metaLabel(m: AreaMeta): string {
  if (isOsmMeta(m)) return `${m.osmType} ${m.osmId}${m.ring > 0 ? ` #${m.ring}` : ''}`;
  return `tile building ${m.key}`;
}

/** True when both describe the same building (keeps the selection across rebuilds). */
export function sameBuilding(a: AreaMeta, b: AreaMeta): boolean {
  if (isOsmMeta(a) && isOsmMeta(b))
    return a.osmId === b.osmId && a.osmType === b.osmType && a.ring === b.ring;
  if (!isOsmMeta(a) && !isOsmMeta(b)) return a.key === b.key;
  return false;
}

/** One line for the stats panel. */
export function skippedText(build: AreaBuild): string {
  if (build.source === 'osm') {
    const o = build.stats;
    return `${o.skippedIncomplete} incomplete, ${o.skippedByTag} by tag, ${o.skippedOutside} outside, ${o.orphanParts} orphan parts`;
  }
  const v = build.stats;
  return `${v.skippedTiny} tiny, ${v.skippedOutside} outside; ${v.stitched} stitched, ${v.truncated} truncated, ${v.defaultHeight} without height`;
}
