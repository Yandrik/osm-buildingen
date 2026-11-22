# three.js adapter (`packages/three`)

```ts
toBufferGeometry(mesh: BuildingMesh): THREE.BufferGeometry
mergeBuildings(meshes: BuildingMesh[]): { geometry, ranges }   // one per tile
createBuildingMaterial(options?): THREE.Material               // vertex colours, flat look
```

- `three` is a peer dependency; no version-specific internals are used.
- `ranges` maps each building to its index range in the merged geometry, for
  picking and for replacing one building without rebuilding the tile.
- Colours are a normalised `Uint8` attribute.
- The default material is `MeshLambertMaterial` with `vertexColors`; normals
  are already flat, so no `flatShading` recomputation is needed.
- The worker returns per-building generation times (`times`) next to the
  meshes, and the pool exposes its `size`.
- Worker helper: `createGeneratorPool(size)` returns
  `generate(inputs): Promise<BuildingMesh[]>` and handles transfer. The worker
  file is a separate entry point so bundlers can pick it up.
