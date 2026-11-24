# Open questions and deferred topics

## Open

- **Vector tiles (OpenMapTiles).** Evaluated and implemented, see
  adapters/vector-tiles.md: footprints, levels (reconstructed from
  `render_height`), addresses, shops and parts survive; roof shapes and types
  do not. Open: PMTiles archives, the Protomaps schema, and whether core
  should accept a `minLevel` / "height without roof" so the levels heuristic
  can go.
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
- **Special buildings without parts.** Places of worship now have a type of
  their own (styles/worship.md). Castles, towers and the other specials are
  still emitted as massing with a guessed type and roof; castles are next
  (battlements as a parapet variant), mosques with them (dome, minaret).

## Deferred

- Special buildings other than places of worship (castles, landmarks).
- Palette texture output.
- Instancing of repeated pieces.
- Sawtooth roofs, round roofs, domes.
- Signage, street furniture, fences.
