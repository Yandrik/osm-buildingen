# Studio (single building)

Purpose: design and debug one building; produce reproducible bug reports.

## Sources

- Preset footprints: rectangle, L, T, U, courtyard, row of townhouses.
- Random footprint from a seed.
- From OSM: load a small area (file or Overpass), click a building; its input
  including neighbours and roads is imported and stays editable.

## Editing

- 2D plan editor: drag vertices, add or remove vertices, draw neighbours and
  road lines.
- Parameters: type, levels, height, roof shape / height / direction, year,
  region, modernity, colours, group key, seed, detail level, shop.
- "Re-roll" changes the seed; "lock" pins the current resolved values into
  the input so later re-rolls keep them.

## Inspecting

- 3D view with orbit controls.
- Stage inspector: resolved spec, walls with context (blocked, street score),
  facade grid as a table of tile ids per wall, roof fallbacks, timings,
  triangle count.

## Export

- Input as JSON; permalink with the input in the URL.
- Mesh as glTF.
- "Copy as test case" writes a snippet for the golden tests.
