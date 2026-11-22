# Studio (single building)

Purpose: design and debug one building; produce reproducible bug reports.
Start with `pnpm studio` (Vite dev server, `apps/studio`).

## Stack

Vite + TypeScript + three.js, no UI framework: plain DOM through a tiny `h()`
helper (`src/dom.ts`), one CSS file with light/dark tokens
(`prefers-color-scheme`). `generateBuilding` runs on the main thread (about
0.2 ms per house), at most once per animation frame, always with `debug: true`.

## Layout

Toolbar on top (sources, view toggles, export). Left: parameters. Centre: 3D
view above the 2D plan editor (Split / 3D / Plan toggle). Right: inspector.
Designed for 1280×800 and up; panels scroll.

## Code structure

| Module | Responsibility |
| --- | --- |
| `state.ts` | Generic `Store<T>` (get/set/update/subscribe); `StudioState` = `BuildingInput` + UI state; `GenerationState` (last good mesh, error); immutable input edits (`patchInput`, `patchRoof`, `patchColours`, ring/neighbour/road setters); validation of untrusted JSON (`parseInput`). No DOM, no three.js. |
| `main.ts` | Creates the stores, the generate loop, neighbour context meshes, toolbar, load dialog, banner, persistence wiring. |
| `view3d.ts` | three.js scene; consumes only `BuildingMesh` (the building and grey context meshes). glTF export. |
| `plan-editor.ts` | Canvas plan editor and its toolbar / selection properties. |
| `params.ts` | Parameter panel. |
| `inspector.ts` | Resolved spec, walls, facade grids, mesh stats. |
| `analysis.ts` | Facts derived from `BuildingDebug` (street wall, entrances, facade grid). |
| `presets.ts` | Preset geometries, seeded random footprint, default input. |
| `share.ts` | Permalink, localStorage, clipboard, test-case snippet, downloads. |
| `osm-import.ts` | `importFromOsm()` stub; the only place to wire `@osm-buildingen/osm`. |

## Sources

- Presets: rectangle, L, T, U, courtyard (rectangle with a hole), narrow
  townhouse lot with neighbours on both sides, garage next to its house
  (`sameGroup` neighbour). Presets come with a road on the south side so a
  street wall is chosen. A preset replaces footprint, neighbours, roads and type;
  other parameters stay.
- Random: seeded rectilinear footprint (rectangle with up to two corner
  notches on a half-metre grid).
- From OSM: button disabled ("available once the OSM adapter lands"); the code
  path is `importFromOsm()` in `src/osm-import.ts`, enabled by
  `OSM_IMPORT_AVAILABLE`. Planned: load a small area (file or Overpass), click a
  building; its input including neighbours and roads is imported and stays
  editable.

## Editing

- 2D plan editor (north up, metres, adaptive grid, scale bar, pan/zoom; edits
  snap to 10 cm): drag vertices; click an edge to insert a vertex; right-click
  or Delete removes a vertex (min 3, roads min 2); drag inside a polygon or
  Shift-drag an edge to move the object; tools to draw neighbours, roads and
  courtyard holes. A selected neighbour shows height / same-plot fields, a
  selected road width / kind / passage.
- Context overlay (only while the mesh matches the current input): blocked
  spans red, shared spans dark red, wall index and street score per wall, the
  street wall green, entrances as dots.
- Parameters: every optional field has an auto state (undefined) and shows the
  resolved value from `debug.spec` greyed next to it: type, levels, height,
  min height, year (shows era), has address, shop, shop probability, roof
  shape / height / levels / direction / ridge, colours (picker + clear),
  region, modernity, group key, detail, base elevation.
- Seed: "Re-roll" (also key R) sets a random seed; "Lock current" copies the
  resolved type, levels, roof shape, roof height and colours into the input so
  re-rolls keep them.

## Inspecting

- 3D view with orbit controls, ground, hemisphere + sun with shadows,
  wireframe toggle, neighbours as translucent grey massing blocks.
- Inspector: resolved spec (era, level heights, roof, palette swatches, wall
  style, facade variant, symmetric, shop, bay width), notes (highlighted when
  non-empty), walls with context (street score, open fraction, blocked and
  shared spans), facade grid per wall as a table of tile ids (rows top to
  bottom, blocked cells shaded, entrances marked, street wall tagged), solver
  attempts / fallback, triangles, vertices, bounds, timings.
- Invalid input (`BuildingInputError`) shows a banner; the last good mesh
  stays.

## Export and persistence

- Copy input JSON; load input JSON (paste dialog, validated).
- Permalink: `#z=<base64url(deflate-raw(JSON))>` (or `#j=<base64url(JSON)>`
  without CompressionStream). The viewer's "open in studio" should use the same
  format. The hash is removed after loading so later edits survive a reload.
- Download glTF (binary `.glb`, three's `GLTFExporter`).
- "Copy as test case": `generateBuilding({...})` snippet with the
  `GENERATOR_VERSION` it was made with.
- The current input is kept in localStorage; a permalink hash wins over it.

## Known gaps

- The core does not expose the chosen street wall or door positions; the studio
  infers them from entrance tiles (`door`, `shopdoor`, `lobby`, `garage_door`)
  in `debug.facade` (see `analysis.ts`). Exposing them in `BuildingDebug` would
  remove the tile-id coupling.
- `parts` are kept in the input but not editable.
