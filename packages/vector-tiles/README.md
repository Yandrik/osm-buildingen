# @osm-buildingen/vector-tiles

Vector tile adapter for [`@osm-buildingen/core`](https://www.npmjs.com/package/@osm-buildingen/core).
Decodes Mapbox Vector Tiles in the OpenMapTiles schema (OpenFreeMap, MapTiler
and others) and turns the buildings into generator inputs.

```sh
npm install @osm-buildingen/core @osm-buildingen/vector-tiles
```

```ts
import { generateBuilding } from '@osm-buildingen/core';
import { buildInputsFromTiles } from '@osm-buildingen/vector-tiles';
import { OPENFREEMAP_TILEJSON, fetchTiles } from '@osm-buildingen/vector-tiles/fetch';

const bbox = { minLat: 48.1365, minLon: 11.5745, maxLat: 48.1395, maxLon: 11.5795 };
const { tiles } = await fetchTiles({ tileJson: OPENFREEMAP_TILEJSON, bbox });
const { inputs } = buildInputsFromTiles(tiles, { style: { region: 'de', modernity: 0.4 }, bbox });
const meshes = inputs.map(generateBuilding);
```

Full documentation: https://github.com/Yandrik/osm-buildingen

MIT license. Map data is © OpenMapTiles © OpenStreetMap contributors.
