# Open questions and deferred topics

## Open

- **Vector tiles (OpenMapTiles).** The building layer there usually carries
  only `render_height` and `render_min_height`, no roof shape, type or
  address, and geometry is clipped at tile borders. To evaluate: how much of
  the adapter's output survives, and how to stitch clipped footprints.
- **Plot polygons.** Grouping currently uses proximity and addresses. A caller
  with parcel data could pass group keys directly; should the OSM adapter
  accept optional plot polygons?
- **Terrain on slopes.** `baseElevation` is one number per building. Walls
  are extended down by a caller-given `plinthDepth`? Decide when terrain is
  wired into the viewer.

## Deferred

- Special buildings (churches, landmarks).
- Palette texture output.
- Instancing of repeated pieces.
- Sawtooth roofs, round roofs, domes.
- Signage, street furniture, fences.
