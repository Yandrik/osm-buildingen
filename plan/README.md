# osm-buildingen – plan

Low-poly procedural building generator for three.js. Buildings are generated from
footprints plus optional attributes (type, levels, roof, neighbours, roads, style,
seed). OSM is the assumed data source, but the library itself is source-agnostic.

This folder is the living design. Update it in the same change as the code.

## Index

| File | Content |
|---|---|
| [00-overview.md](00-overview.md) | Goals, non-goals, fixed decisions |
| [01-architecture.md](01-architecture.md) | Packages, dependency rules, data flow, repo layout |
| [02-input-api.md](02-input-api.md) | Public API: input, output, coordinate conventions |
| [pipeline/README.md](pipeline/README.md) | The generation stages at a glance |
| [pipeline/01-resolve.md](pipeline/01-resolve.md) | Type, dimensions, era, palette |
| [pipeline/02-massing-roofs.md](pipeline/02-massing-roofs.md) | Walls, roof shapes, straight skeleton |
| [pipeline/03-context.md](pipeline/03-context.md) | Blocked walls, street side, passages |
| [pipeline/04-facade-wfc.md](pipeline/04-facade-wfc.md) | Facade grid and the constraint solver |
| [pipeline/05-roof-details.md](pipeline/05-roof-details.md) | Dormers, chimneys, flat-roof clutter |
| [pipeline/06-mesh.md](pipeline/06-mesh.md) | Mesh builder, pieces, output buffers |
| [styles/README.md](styles/README.md) | Style pack format |
| [styles/modernity.md](styles/modernity.md) | Era model behind the modernity slider |
| [styles/de-residential.md](styles/de-residential.md) | German pack |
| [styles/us-suburban.md](styles/us-suburban.md) | US suburban pack |
| [styles/non-residential.md](styles/non-residential.md) | Office, skyscraper, industrial, station, store |
| [03-determinism.md](03-determinism.md) | Seeds, sub-seeds, versioning |
| [04-performance.md](04-performance.md) | Workers, merging, detail levels, budgets |
| [adapters/three.md](adapters/three.md) | three.js adapter |
| [adapters/osm.md](adapters/osm.md) | OSM adapter |
| [apps/viewer.md](apps/viewer.md) | OSM area debug viewer |
| [apps/studio.md](apps/studio.md) | Single-building studio |
| [05-testing.md](05-testing.md) | Test strategy |
| [06-milestones.md](06-milestones.md) | Milestones and current status |
| [07-open-questions.md](07-open-questions.md) | Open questions and deferred topics |
