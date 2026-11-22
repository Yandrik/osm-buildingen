# @osm-buildingen/core

Low-poly procedural building generator. Footprint and attributes in, mesh
buffers out. Pure TypeScript with no DOM and no three.js, so it runs in browsers,
workers and Node.

```sh
npm install @osm-buildingen/core
```

```ts
import { generateBuilding } from '@osm-buildingen/core';

const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [11, 0], [11, 9], [0, 9]] }, // metres, x east, y north
  levels: 2,
  roof: { shape: 'gabled' },
  style: { region: 'de', modernity: 0.3 },
  seed: 'my-building',
});
// mesh.positions, mesh.normals, mesh.colors, mesh.indices
```

Use [`@osm-buildingen/three`](https://www.npmjs.com/package/@osm-buildingen/three)
to turn the result into a three.js geometry.

Full documentation and more examples: https://github.com/Yandrik/osm-buildingen

MIT license.
