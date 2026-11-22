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

- **Shared app code.** The viewer copies `dom.ts`, the permalink encoder and
  the base CSS from the studio. Small today; move into a private
  `packages/app-kit` when a third copy or a divergence appears.
- **Pool cancellation.** The worker pool cannot cancel queued batches; the
  viewer limits in-flight batches and ignores stale results. Add a cancel
  token if tile churn becomes a cost.
- **Special buildings without parts.** They are emitted as massing with a
  guessed type and roof. A dedicated `special` type with calmer defaults
  (gabled, no clutter) would look better until they get real support.

## Deferred

- Special buildings (churches, landmarks).
- Palette texture output.
- Instancing of repeated pieces.
- Sawtooth roofs, round roofs, domes.
- Signage, street furniture, fences.
