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
| `osm-import.ts` | The only place that uses `@osm-buildingen/osm`. No DOM: parse `.osm` / Overpass JSON, location text parsing (`lat, lon`, osm.org URLs, `way/<id>`), element-locating Overpass query, `fetchArea`, search, group members, re-centring (`inputForBuilding`). |
| `osm-dialog.ts` | "From OSM…" dialog: sources (file, location, sample), progress / retry, search list, summary, load. |
| `osm-picker.ts` | Canvas picker map in the dialog: footprints by type, special buildings hatched, roads, hover tooltip, click / double-click. |

Tests: `pnpm --filter @osm-buildingen/studio test` (own `vitest.config.ts`; the
root config covers `packages/*` only). `src/osm-import.test.ts` checks location
parsing, the Overpass queries, the error path with a mocked `fetch`, re-centring
on the Ulm fixture and the permalink round trip of parts / neighbours / roads.

## Sources

- Presets: rectangle, L, T, U, courtyard (rectangle with a hole), narrow
  townhouse lot with neighbours on both sides, garage next to its house
  (`sameGroup` neighbour). Presets come with a road on the south side so a
  street wall is chosen. A preset replaces footprint, neighbours, roads and type;
  other parameters stay.
- Random: seeded rectilinear footprint (rectangle with up to two corner
  notches on a half-metre grid).
- From OSM… opens a dialog with three sources:
  - File: choose or drop `.osm` XML or Overpass `.json` (first character decides).
  - Location: one field taking `lat, lon`, an openstreetmap.org URL
    (`#map=z/lat/lon`, `?mlat=&mlon=`), or a way / relation (`way/25697720`,
    `w25697720`, osm.org element URL); radius (default 120 m, max 400 m) and
    endpoint (public default, reset button). A point fetches its square box with
    `fetchOverpass`. An element is first located with a small query
    (`(way(id);>;);out skel qt;`, parsed by `parseOverpassJson`, centre of the
    node box), then its box is fetched with the radius grown to the element's
    size + 40 m, and the element is preselected. Progress with elapsed time and
    Cancel; retryable `OverpassError`s (429, 502, 503, 504, busy remarks) show
    "server busy, try again" with a Retry button.
  - Sample: `packages/osm/test/fixtures/ulm-minster.osm`, referenced through
    Vite (`?url`), fetched on demand.
  `buildInputs` runs once per loaded area (no bbox for files; the fetch box as
  bbox and its centre as origin for locations). The area stays in memory for the
  session, so reopening the dialog shows the same map; the source settings
  (tab, location text, radius, endpoint) are kept in localStorage.
- Picker: canvas map, north up, drag to pan, wheel to zoom. Footprints coloured
  by the adapter's type (legend), special buildings hatched and paler, roads at
  their width, paths and rails as thin lines. Hover tooltip: name / address /
  type and reason / OSM id. Search by name, address or OSM id filters the list
  and fades the other buildings; with an empty search the list shows named
  buildings. Click selects (accent outline, group members dashed), double-click
  loads.
- Summary: name, link to osm.org, type and reason, special, area, neighbours
  (same plot), roads (passages), parts, group key and members with "open
  instead" (jump from a house to its garage), the tags that matter. Option
  "include same-plot buildings as neighbours" (on by default; off drops
  `sameGroup` neighbours).
- "Load into studio" replaces the input with the building's `BuildingInput`
  re-centred on its footprint area centroid (footprint, parts, neighbours and
  roads translated, rounded to 1 cm). Seed and group key stay the adapter's;
  `style` comes from the studio's current input. `detail: 'massing'` of special
  buildings is kept and shown in the detail control. The source (OSM type + id,
  osm.org link) is UI state (`ui.source`), shown as a chip next to the button
  until the footprint is edited or another source is loaded; it is not persisted.

## Editing

- 2D plan editor (north up, metres, adaptive grid, scale bar, pan/zoom; edits
  snap to 10 cm): drag vertices; click an edge to insert a vertex; right-click
  or Delete removes a vertex (min 3, roads min 2); drag inside a polygon or
  Shift-drag an edge to move the object; tools to draw neighbours, roads and
  courtyard holes. A selected neighbour shows height / min height / same-plot
  fields, a selected road width / kind / passage. Parts (from OSM) are drawn
  read-only as dashed outlines with their height or levels and roof shape (label
  only where it fits); they are not hit-tested.
- Context overlay (only while the mesh matches the current input): blocked
  spans red, shared spans dark red, wall index and street score per wall, the
  street wall green, entrances as dots.
- Parameters: every optional field has an auto state (undefined) and shows the
  resolved value from `debug.spec` greyed next to it: type, levels, height,
  min height, year (shows era), has address, shop, shop probability, entrance,
  parts ("N parts (read-only)" with "remove parts", only when there are parts), roof
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
  format. The hash is removed after loading so later edits survive a reload; the
  linked input is written to localStorage right away for the same reason.
- Validation (`parseInput`, used by permalink, Load JSON and storage) checks the
  structure the studio reads and the types of optional fields (numbers,
  booleans, road `kind`, `detail`, parts' footprints); everything else passes
  through unchanged, so parts, neighbour `height` / `minHeight` / `sameGroup`
  and road `kind` / `width` / `passage` round-trip (tested).
- Download glTF (binary `.glb`, three's `GLTFExporter`).
- "Copy as test case": `generateBuilding({...})` snippet with the
  `GENERATOR_VERSION` it was made with.
- The current input is kept in localStorage; a permalink hash wins over it.

## Known gaps

- The core does not expose the chosen street wall or door positions; the studio
  infers them from entrance tiles (`door`, `shopdoor`, `lobby`, `garage_door`)
  in `debug.facade` (see `analysis.ts`). Exposing them in `BuildingDebug` would
  remove the tile-id coupling.
- `parts` are kept in the input but not editable (shown read-only, can be removed).
  A preset or random footprint drops them.
- `fetchOverpass` only takes a bbox and treats 502 as not retryable; the
  element lookup posts its own query (and treats 502 as busy). The adapter has
  no "locate element" helper and `BuildResult` has no index by OSM id.
- With parts, `debug.walls` / `debug.context` describe the entrance part only,
  so the plan overlay shows that part's walls.
