# @osm-buildingen/three

three.js adapter for [`@osm-buildingen/core`](https://www.npmjs.com/package/@osm-buildingen/core):
geometry conversion, merging many buildings into one draw call, picking, and a
worker pool.

```sh
npm install @osm-buildingen/core @osm-buildingen/three three
```

```ts
import * as THREE from 'three';
import { generateBuilding } from '@osm-buildingen/core';
import { createBuildingMaterial, toBufferGeometry } from '@osm-buildingen/three';

const mesh = generateBuilding({
  footprint: { outer: [[0, 0], [11, 0], [11, 9], [0, 9]] },
  style: { region: 'de', modernity: 0.3 },
  seed: 1,
});
scene.add(new THREE.Mesh(toBufferGeometry(mesh), createBuildingMaterial()));
```

Worker pool (Vite and webpack 5 both understand this worker URL):

```ts
import { createGeneratorPool, mergeBuildings } from '@osm-buildingen/three';

const pool = createGeneratorPool({
  createWorker: () =>
    new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
});
const { meshes } = await pool.generate(inputs);
const { geometry } = mergeBuildings(meshes.filter((m) => m !== null));
```

Full documentation: https://github.com/Yandrik/osm-buildingen

MIT license.
