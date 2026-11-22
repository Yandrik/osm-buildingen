# Milestones

Status legend: [ ] open, [~] in progress, [x] done.

1. [x] **Skeleton.** Workspace, core types, rng, mesh builder, resolve,
   massing with flat / gabled / skillion / pyramidal roofs, three adapter,
   studio.
2. [x] **Roofs.** Straight skeleton, hipped and gabled on arbitrary
   footprints, courtyards, multi-part buildings.
3. [x] **Facades.** Context stage, facade solver, pieces, German residential
   pack, garages and sheds with plot-consistent colours.
4. [x] **OSM.** Adapter, area viewer with workers and tile merging, OSM
   import in the studio.
5. [x] **Eras and regions.** Modernity across the German pack including
   timber frame; US suburban pack.
6. [~] **More types.** Townhouse / store, office, skyscraper, industrial,
   station all generate from the German definitions. Still open: skyscraper
   podium and crown, station platform canopy, sawtooth roofs, US-specific
   commercial tiles.
7. [~] **Finish.** Passages and arches, roof details (chimneys, dormers,
   attic windows, rooftop units), massing detail level and golden tests are
   done. Still open: a real tunnel through the building (the arch is a dark
   recess), trim bands, benchmarks in the browser, tuning on real towns.
8. [x] **Vector tiles.** Evaluate OpenMapTiles as an input source. Evaluated
   and added as `packages/vector-tiles` with a viewer source; same buildings and
   levels as the OSM adapter in Ulm, without roof shapes and types.

Each milestone ends with: tests green, plan updated, commit.
