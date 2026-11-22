/**
 * OSM import: the one place to wire `@osm-buildingen/osm` into the studio.
 *
 * TODO(osm adapter): load a small area (file or Overpass), let the user pick a building,
 * and return its `BuildingInput` including neighbours and roads in a local metre frame
 * centred on that building. The toolbar button in main.ts is disabled until then; enable
 * it by setting `OSM_IMPORT_AVAILABLE` to true. Nothing else needs to change: the caller
 * loads the returned input exactly like a pasted JSON input.
 */
import type { BuildingInput } from '@osm-buildingen/core';

export const OSM_IMPORT_AVAILABLE = false;

export async function importFromOsm(): Promise<BuildingInput> {
  throw new Error('OSM import is not implemented yet (available once the OSM adapter lands).');
}
