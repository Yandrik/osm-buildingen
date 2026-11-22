# @osm-buildingen/osm

OpenStreetMap adapter for [`@osm-buildingen/core`](https://www.npmjs.com/package/@osm-buildingen/core).
Parses OSM XML or Overpass JSON and turns buildings into generator inputs, with
neighbours, nearby roads, building parts and shop nodes worked out for you.

```sh
npm install @osm-buildingen/core @osm-buildingen/osm
```

```ts
import { generateBuilding } from '@osm-buildingen/core';
import { buildInputs } from '@osm-buildingen/osm';
import { fetchOverpass } from '@osm-buildingen/osm/overpass';

const bbox = { minLat: 48.1365, minLon: 11.5745, maxLat: 48.1395, maxLon: 11.5795 };
const { inputs } = buildInputs(await fetchOverpass(bbox), {
  style: { region: 'de', modernity: 0.4 },
  bbox,
});
const meshes = inputs.map(generateBuilding);
```

For a local file use `parseOsmXml(text)` or `parseOverpassJson(json)` instead of
`fetchOverpass`.

Full documentation: https://github.com/Yandrik/osm-buildingen

MIT license. Map data is © OpenStreetMap contributors (ODbL).
