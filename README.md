# osm-buildingen

Low-poly procedural buildings for three.js, generated from footprints.

Give it a footprint and whatever you know about the building (type, levels,
height, roof shape, neighbours, nearby roads, a style and a seed) and it returns
a flat-shaded mesh: walls with doors, windows, balconies and shop fronts, a roof
with the right shape, chimneys and dormers. The same input always gives the same
building. Data usually comes from OpenStreetMap, but the generator itself does
not care where it comes from.

```ts
import { generateBuilding } from '@osm-buildingen/core';
import { toBufferGeometry, createBuildingMaterial } from '@osm-buildingen/three';

const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [11, 0], [11, 9], [0, 9]] }, // metres, x east, y north
  levels: 2,
  roof: { shape: 'gabled' },
  roads: [{ line: [[-30, -8], [40, -8]] }],                 // the door faces this
  style: { region: 'de', modernity: 0.3 },                  // 0 = old, 1 = new
  seed: 'my-building',
});
scene.add(new THREE.Mesh(toBufferGeometry(mesh), createBuildingMaterial()));
```

From OpenStreetMap:

```ts
import { parseOsmXml, buildInputs } from '@osm-buildingen/osm';

const { inputs } = buildInputs(parseOsmXml(osmXmlText), { style: { region: 'de', modernity: 0.4 } });
const meshes = inputs.map(generateBuilding);                // or use the worker pool, see packages/three
```

## Packages

| Package | What |
|---|---|
| `packages/core` | The generator. Pure TypeScript, no DOM, no three.js. |
| `packages/three` | three.js adapter: geometry, per-tile merging, worker pool. |
| `packages/osm` | OpenStreetMap data to generator input. |
| `apps/studio` | Design and debug one building (`pnpm studio`, port 5173). |
| `apps/viewer` | Generate a whole OSM area (`pnpm viewer`, port 5174). |

## Development

```
pnpm install
pnpm test          # all tests
pnpm typecheck
pnpm lint
pnpm studio        # or: pnpm viewer
pnpm exec tsx tools/sheet.ts renders   # sample sheets as PNG, no GPU needed
```

The design lives in [`plan/`](plan/README.md); working rules are in `CLAUDE.md`.

Map data in `packages/osm/test/fixtures` is © OpenStreetMap contributors (ODbL).
