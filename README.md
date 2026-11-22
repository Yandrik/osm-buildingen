# osm-buildingen

Low-poly procedural buildings for three.js, generated from footprints.

Give it a footprint and whatever you know about the building (type, levels,
height, roof shape, neighbours, nearby roads, a style and a seed). It returns a
flat-shaded mesh with walls, doors, windows, balconies, shop fronts, a roof of
the right shape, chimneys and dormers. The same input always gives the same
building. Data usually comes from OpenStreetMap, but the generator itself does
not care where it comes from.

- Deterministic: output is a pure function of the input and the seed.
- Fast: a typical house takes well under a millisecond, and a worker pool is included.
- Small output: one draw call per map tile when buildings are merged.
- Two built-in style packs (German and US suburban), each with an era slider
  from old to new.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Examples](#examples)
- [Coordinates](#coordinates)
- [Packages](#packages)
- [Development](#development)
- [Publishing to npm](#publishing-to-npm)
- [License](#license)

## Installation

Install the generator plus the adapters you need:

```sh
npm install @osm-buildingen/core                      # the generator, nothing else
npm install @osm-buildingen/three three               # three.js geometry, merging, workers
npm install @osm-buildingen/osm                       # OpenStreetMap XML, Overpass JSON
npm install @osm-buildingen/vector-tiles              # OpenMapTiles vector tiles
```

`pnpm add` and `yarn add` work the same way.

Requirements:

- The packages are ES modules only. Use `import`, not `require`.
- TypeScript types are included. Both `"moduleResolution": "bundler"` and `"nodenext"` work.
- `@osm-buildingen/three` needs `three` 0.160 or newer as a peer dependency.
- `@osm-buildingen/core` has no DOM or three.js dependency. It runs in
  browsers, web workers and Node 18 or later.
- The network helpers (`@osm-buildingen/osm/overpass` and
  `@osm-buildingen/vector-tiles/fetch`) use the global `fetch`.

### Bundler setup for the worker pool

The worker is loaded with `new URL('@osm-buildingen/three/worker', import.meta.url)`,
which Vite and webpack 5 both understand without plugins. Vite needs module
workers for production builds:

```js
// vite.config.js
export default {
  worker: { format: 'es' },
};
```

### Without the npm registry

To try a local checkout in another project before anything is published, pack
the packages and install the tarballs:

```sh
cd osm-buildingen
pnpm install
pnpm -r --filter './packages/*' pack --pack-destination ../osm-buildingen-tarballs
```

Then point your project at them. The `overrides` block makes the adapters use
the local `core` too:

```json
{
  "dependencies": {
    "@osm-buildingen/core": "file:../osm-buildingen-tarballs/osm-buildingen-core-0.1.0.tgz",
    "@osm-buildingen/three": "file:../osm-buildingen-tarballs/osm-buildingen-three-0.1.0.tgz"
  },
  "overrides": {
    "@osm-buildingen/core": "file:../osm-buildingen-tarballs/osm-buildingen-core-0.1.0.tgz"
  }
}
```

With pnpm, use `pnpm.overrides` instead of `overrides`. Yarn calls it `resolutions`.

## Quick start

```ts
import * as THREE from 'three';
import { generateBuilding } from '@osm-buildingen/core';
import { createBuildingMaterial, toBufferGeometry } from '@osm-buildingen/three';

const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [11, 0], [11, 9], [0, 9]] }, // metres, x east, y north
  levels: 2,
  roof: { shape: 'gabled' },
  roads: [{ line: [[-30, -8], [40, -8]] }], // the entrance faces this road
  style: { region: 'de', modernity: 0.3 }, // 0 = old, 1 = new
  seed: 'my-building',
});

scene.add(new THREE.Mesh(toBufferGeometry(mesh), createBuildingMaterial()));
```

Only `footprint`, `style` and `seed` are required. Everything else is filled in
from the style pack and the seed.

## Examples

### Let the generator decide

```ts
const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [10, 0], [10, 8], [0, 8]] },
  style: { region: 'de', modernity: 0.5 },
  seed: 42,
});
```

Type, levels, roof shape, colours and facade are all rolled from the seed. Change
the seed to get a different building on the same footprint.

### Apartment block with a shop and balconies

```ts
const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [24, 0], [24, 12], [0, 12]] },
  type: 'apartments',
  levels: 5,
  shop: true, // ground-floor store on the street side
  balconies: true, // force balconies (they are rolled otherwise)
  roads: [{ line: [[-50, -8], [80, -8]] }],
  style: { region: 'de', modernity: 0.8 },
  seed: 'block-7',
});
```

### Pinning the look

```ts
const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [9, 0], [9, 7], [0, 7]] },
  type: 'house',
  year: 1925, // overrides the era roll
  height: 9.5, // total height including the roof
  roof: { shape: 'half-hipped', ridge: 'across', colour: '#8f3b2a' },
  colours: { wall: '#efe6cf', door: '#3f5d48' },
  facadeVariant: 'shutters',
  style: { region: 'de', modernity: 0.2 },
  seed: 'villa',
});
```

Building types: `house`, `apartments`, `townhouse`, `garage`, `shed`, `office`,
`skyscraper`, `industrial`, `station`, `store`, `canopy`.

Roof shapes: `flat`, `gabled`, `hipped`, `half-hipped`, `pyramidal`, `skillion`,
`gambrel`, `mansard`, `dome`, `onion`, `cone`, `round`, `sawtooth`.

### Terraced row with neighbours

Walls that touch a neighbour get no windows or doors. Pass the neighbouring
footprints and the generator blanks the shared stretches.

```ts
const plot = (x: number): [number, number][] => [[x, 0], [x + 7, 0], [x + 7, 11], [x, 11]];

const row = [0, 7, 14].map((x, i, all) =>
  generateBuilding({
    footprint: { outer: plot(x) },
    type: 'townhouse',
    neighbours: all.filter((other) => other !== x).map((other) => ({ footprint: { outer: plot(other) } })),
    roads: [{ line: [[-20, -8], [40, -8]] }],
    style: { region: 'de', modernity: 0.1 },
    seed: `row-${i}`,
    groupKey: 'row', // same era and palette for the whole row
  }),
);
```

### Building parts

A main hall with a tower, as mapped with OSM `building:part`. The tower is built
with its own height and roof, and the rest of the outline becomes the hall.

```ts
const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [30, 0], [30, 14], [0, 14]] },
  height: 14,
  roof: { shape: 'gabled' },
  parts: [
    {
      footprint: { outer: [[-7, 3], [0, 3], [0, 10], [-7, 10]] },
      height: 42,
      roof: { shape: 'pyramidal' },
    },
  ],
  style: { region: 'de', modernity: 0.1 },
  seed: 'hall',
});
```

### Courtyards and passages

Holes in the footprint become courtyards (clockwise rings). A road marked as a
passage is cut through the ground floor as an arch.

```ts
const mesh = generateBuilding({
  footprint: {
    outer: [[0, 0], [30, 0], [30, 30], [0, 30]],
    holes: [[[8, 8], [8, 22], [22, 22], [22, 8]]],
  },
  type: 'apartments',
  levels: 4,
  roads: [{ line: [[15, -10], [15, 15]], passage: true }],
  style: { region: 'de', modernity: 0.3 },
  seed: 'courtyard',
});
```

### Inspect the decisions without building geometry

```ts
import { resolveBuilding } from '@osm-buildingen/core';

const spec = resolveBuilding({
  footprint: { outer: [[0, 0], [10, 0], [10, 8], [0, 8]] },
  style: { region: 'us', modernity: 0.6 },
  seed: 3,
});
console.log(spec.type, spec.levelHeights, spec.roof.shape, spec.balcony?.railing);
```

Pass `debug: true` to `generateBuilding` to get the walls, wall context, facade
grid and notes on `mesh.debug` as well.

### From an OpenStreetMap extract

```ts
import { generateBuilding } from '@osm-buildingen/core';
import { buildInputs, parseOsmXml } from '@osm-buildingen/osm';

const { inputs, meta, origin } = buildInputs(parseOsmXml(osmXmlText), {
  style: { region: 'de', modernity: 0.4 },
  seed: 'my-town', // change to re-roll the whole town
  shopProbability: 0.3,
});
const meshes = inputs.map(generateBuilding);
```

The adapter projects coordinates around `origin`, finds neighbours and roads for
every building, and reads tags such as `building`, `building:levels`, `height`,
`roof:shape`, `roof:colour`, `building:colour` and shop nodes. `meta[i]`
explains how `inputs[i]` was classified.

### Live from the Overpass API

```ts
import { buildInputs } from '@osm-buildingen/osm';
import { fetchOverpass } from '@osm-buildingen/osm/overpass';

const bbox = { minLat: 48.1365, minLon: 11.5745, maxLat: 48.1395, maxLon: 11.5795 };
const data = await fetchOverpass(bbox);
const { inputs } = buildInputs(data, { style: { region: 'de', modernity: 0.3 }, bbox });
```

### From vector tiles (OpenMapTiles schema)



```ts
import { buildInputsFromTiles } from '@osm-buildingen/vector-tiles';
import { OPENFREEMAP_TILEJSON, fetchTiles } from '@osm-buildingen/vector-tiles/fetch';

const { tiles } = await fetchTiles({ tileJson: OPENFREEMAP_TILEJSON, bbox });
const { inputs } = buildInputsFromTiles(tiles, { style: { region: 'de', modernity: 0.4 }, bbox });
```

Vector tiles carry less detail than raw OSM data (no roof shapes or shop nodes),
but they are cached by tile servers and quick to load.
**Not recommended** because of lower data fidelity, especially for big multi-part buildings like churches. 

### Many buildings: workers and merging

```ts
import { createBuildingMaterial, createGeneratorPool, mergeBuildings } from '@osm-buildingen/three';

const pool = createGeneratorPool({
  createWorker: () =>
    new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
});

const { meshes, errors } = await pool.generate(inputsOfOneTile);
const { geometry, ranges } = mergeBuildings(meshes.filter((m) => m !== null));
scene.add(new THREE.Mesh(geometry, createBuildingMaterial()));
```

`buildingAtFace(ranges, hit.faceIndex)` maps a raycast hit on the merged mesh
back to the building it belongs to.

### Massing only

For distant tiles, `detail: 'massing'` skips doors, windows and roof details and
returns plain walls and roofs.

```ts
const far = generateBuilding({ ...input, detail: 'massing' });
```

### Custom style packs

Style packs are plain data: palettes, level heights, roof shape weights, facade
tiles and probabilities, each as a function of the era. Start from a built-in
pack and change what you need.

```ts
import { getStylePack, registerStylePack } from '@osm-buildingen/core';

const de = getStylePack('de');
registerStylePack({
  ...de,
  id: 'de-red-roofs',
  palette: { ...de.palette, roof: [['#b5452f', 1]] },
});

const mesh = generateBuilding({ ...input, style: { region: 'de', modernity: 0.5, pack: 'de-red-roofs' } });
```

`registerStylePack` validates the pack and throws a readable error on the first
problem it finds. The format is described in [`plan/styles`](plan/styles/README.md).

## Coordinates

| | Input | Output |
|---|---|---|
| Units | metres | metres |
| Axes | x = east, y = north | X = east, Y = up, Z = south |
| Rings | outer counter-clockwise, holes clockwise, not closed | |

The output axes match three.js defaults, so a mesh can be added to a scene
without any rotation. `baseElevation` lifts the whole building, for example onto
terrain.

## Packages

| Package | What |
|---|---|
| `packages/core` | The generator. Pure TypeScript, no DOM, no three.js. |
| `packages/three` | three.js adapter: geometry, merging, picking, worker pool. |
| `packages/osm` | OpenStreetMap data (XML, Overpass JSON) to generator input. |
| `packages/vector-tiles` | OpenMapTiles-schema vector tiles to generator input. |
| `apps/studio` | Design and debug a single building (`pnpm studio`, port 5173). |
| `apps/viewer` | Generate every building in an OSM area (`pnpm viewer`, port 5174). |

## Development

```sh
pnpm install
pnpm test            # all tests
pnpm typecheck
pnpm lint
pnpm studio          # or: pnpm viewer
pnpm golden:update   # after a deliberate change to the output
pnpm exec tsx tools/sheet.ts renders   # sample sheets as PNG, no GPU needed
```

`pnpm build` compiles the four packages to `packages/*/dist` with tsup. The
apps and tests do not need it, because inside the workspace every package
points straight at its TypeScript source. Only the published packages use `dist`.

The design lives in [`plan/`](plan/README.md).

Map data in `packages/osm/test/fixtures` is © OpenStreetMap contributors (ODbL).

## Publishing to npm

The four packages in `packages/` are published together under the
`@osm-buildingen` scope, always with the same version number. The apps are
private and never published.

One-time setup:

1. Create an npm account and log in with `npm login`.
2. Create the organisation `osm-buildingen` on npmjs.com (free for public
   packages). The scope in the package names must match an organisation or
   user you own. To publish under your own user instead, rename the packages
   to `@your-name/...` everywhere.
3. Turn on two-factor authentication. If npm asks for a one-time code during
   publishing, pass it as `pnpm release --otp=123456`.

Each release:

```sh
git switch main && git pull
pnpm install

# 1. Set the new version on all four packages (npm rewrites the JSON, format puts it back).
pnpm -r --filter './packages/*' exec npm pkg set version=0.2.0
pnpm format

# 2. Check everything.
pnpm test && pnpm typecheck && pnpm lint

# 3. Look at what would be uploaded.
pnpm -r --filter './packages/*' publish --dry-run --no-git-checks

# 4. Commit, tag and publish.
git commit -am "Release 0.2.0"
git tag v0.2.0
pnpm release
git push && git push --tags
```

`pnpm release` runs `pnpm -r --filter './packages/*' publish`. Use `pnpm`, not
`npm publish`. pnpm builds each package first (the `prepack` script), swaps the
source entry points for the built ones in `dist` (`publishConfig`), and rewrites
the internal `workspace:*` dependencies to the real version number. It also
publishes in dependency order (`core` first) and skips versions that are
already on the registry, so a failed run can simply be repeated. It refuses to
publish from a dirty working tree or a branch other than `main`.

Version numbers follow semver. While the version is below 1.0, bump the minor
number (0.1 to 0.2) for anything that changes the output for an existing input,
because users pin versions to keep their buildings stable.

## License

MIT, see [LICENSE](LICENSE).
