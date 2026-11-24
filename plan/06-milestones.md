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
6. [x] **More types.** Townhouse / store, office, skyscraper (podium, shaft,
   crown), industrial (sawtooth roofs, stacks), station (platform roof,
   arched windows) and the open-sided canopy type. US-specific commercial
   tiles are deferred.
7. [~] **Finish.** Real passages through buildings, roof details, trim bands
   on older buildings, massing detail level and golden tests are done. Parts
   that do not cover their outline now leave the outline's body standing, and
   dome, onion, cone, round and sawtooth roofs exist. Still open: terrain,
   benchmarks on a real GPU, tuning on real towns.
8. [x] **Vector tiles.** Evaluate OpenMapTiles as an input source. Evaluated
   and added as `packages/vector-tiles` with a viewer source; same buildings and
   levels as the OSM adapter in Ulm, without roof shapes and types.

9. [~] **Places of worship.** `worship` type: roles for mapped parts
   (main, tower, small), romanesque / gothic / classic / modern windows,
   belfries, and a ridge turret or west tower for churches without parts
   (styles/worship.md). Also: rows by volume, bays between mapped
   buttresses, straight eaves over buttresses in the outline, hipped apse
   ends, profile (lathe) roofs, steeple designs as style data (octagon and
   spire, bell roof with lantern, onion), portals with rose windows, clocks,
   finials, faith. Next: orthodox and synagogue facades, mosques, castles.

Each milestone ends with: tests green, plan updated, commit.
