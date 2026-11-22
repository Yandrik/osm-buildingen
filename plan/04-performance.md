# Performance

Quality first, but the design must allow live generation. Nothing here is
measured yet; budgets are targets to check in milestone 7.

## Design choices

- **Workers.** `core` is free of DOM and three.js, so it runs in a worker
  pool. Results are transferable typed arrays.
- **One geometry per map tile.** The three adapter merges all buildings of a
  tile into one `BufferGeometry` with vertex colours and one shared material:
  one draw call per tile.
- **Two detail levels.** `massing` for far tiles, `full` for near ones, from
  the same seed. Switching is a regenerate, not a second stored mesh.
- **Small solves.** Facade grids have tens of cells; compatibility tables are
  precomputed per style pack.
- **No per-building objects** in the scene graph. Picking in the viewer uses
  a per-vertex building index kept beside the merged geometry.
- **Caching.** The caller can cache by `hash(input)`; the library exposes
  `hashInput()`.

## Targets

| Item | Target |
|---|---|
| Typical house, full detail | under 2 ms in a worker |
| Tile with 300 buildings | under 0.5 s across the pool |
| Triangles per house | 300 – 1500 |
| Main-thread work per tile | buffer upload only |

## Tile borders

A building belongs to the tile containing its centroid. Seeds never depend on
the tile. The adapter fetches neighbours from a margin around the tile so
context is the same from either side.

## Later optimisations (not now)

Instanced pieces for repeated windows, geometry quantisation, impostors for
very far tiles, incremental tile updates.
