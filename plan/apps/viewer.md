# Viewer (OSM area debugger)

Purpose: see the generator on real areas, find bad cases, measure.
`pnpm viewer` → http://localhost:5174 (fixed, `strictPort`; preview 4174). The
studio keeps 5173 / 4173. `?sample` in the URL loads the bundled extract at start.

## Features

- **Load**: "Load sample" (the Ulm fixture, `packages/osm/test/fixtures/ulm-minster.osm`,
  imported with `?url` so Vite serves / emits it from its original place), file
  picker or drag and drop (`.osm` XML or Overpass `.json`, detected by extension
  then first character), or Overpass by bounding box (`min lon, min lat, max lon,
  max lat`, also `bbox=…`) or centre + radius, with an editable endpoint. Areas
  above 25 km² are refused. Overpass errors show the adapter's message; retryable
  ones (429, 503/504, runtime-error remarks) get a Retry button. Overpass loads pass
  the bbox to `buildInputs` so only buildings with their centroid inside are emitted.
- **Vector tiles**: the same bbox / centre fields, a TileJSON URL or `{z}/{x}/{y}`
  template (default OpenFreeMap, `https://tiles.openfreemap.org/planet`), an API
  key field that is not persisted, and the zoom (13–16, default 14, clamped to the
  TileJSON `maxzoom`). The data worker runs `fetchTiles` (at most 36 tiles) and
  keeps the decoded tiles; builds use `buildInputsFromTiles` with the same options
  as OSM (see adapters/vector-tiles.md). The inspector then shows the tile
  properties, height source, house numbers, POIs, landuse and tiles instead of
  OSM tags, and links openstreetmap.org at the building's position. The
  attribution line in the map corner shows OpenFreeMap (when used),
  © OpenMapTiles and © OpenStreetMap contributors.
- **Data worker** (`data-worker.ts`): reading, parsing and `buildInputs` run off the
  main thread. The worker keeps the parsed `OsmData`, so a style/seed change posts
  only the options. Newer requests supersede older ones (main ignores stale ids;
  the worker collapses queued builds into the newest).
- **Tiles**: squares aligned to the local origin (default 250 m, configurable); a
  building belongs to the tile containing `meta.centroid`. Each tile is split into
  batches of ≤ 48 buildings so a big tile still spreads over the pool; the tile is
  merged (`mergeBuildings`, one mesh, shared material) when all its batches are
  back. The scheduler keeps `pool size` batches in flight, finishes started tiles
  first, then picks the tile nearest to the camera target (evaluated at pick time).
- **Controls** (all persisted in localStorage): region, modernity, global seed,
  townhouse store probability (or pack default), tile size, detail (full /
  massing / auto = full within N m of the camera target). Auto is re-evaluated
  when the camera has been still for 400 ms; only tiles whose level changed are
  regenerated. At full level special buildings keep the adapter's `massing`.
  Old tiles stay visible until replaced; stale ones are removed when the new
  generation is complete. A tile-size change clears the scene first.
- **Scene**: OrbitControls (damping, ground-plane panning, zoom to cursor, polar
  limit), ground plane sized to the data, roads as flat strips with round joins
  (width from the adapter, colour by kind, theme-aware), hemisphere + sun, optional
  shadows (sun frustum covers the area) and fog. Camera fits the data on load.
- **Picking**: click (not drag) → raycast on current-generation tiles →
  `buildingAtFace` → global index. The building's vertex-colour range is tinted
  and its footprint outlined at ground and roof height.
- **Inspector**: OSM link, adapter decision (`type`, `typeReason`, special, group
  and its size, parts, neighbours, roads/passage), resolved spec, notes, facade
  fallback and stage timings from one main-thread
  `generateBuilding({ ...input, debug: true })`, all tags, the exact input JSON
  (copy button), "Open in studio" (studio URL configurable, default
  http://localhost:5173/). The link uses the studio's permalink format
  (`#z=` deflate-raw base64url, `#j=` fallback); the input is recentred on the
  building (rounded centroid, millimetre coordinates) so it opens near the studio
  origin. The JSON shown and copied is the exact, unshifted input.
- **Overlays**: colour by building type (resolved), plot group (groups of one are
  grey), era (resolved), special, notes/fallbacks; plus passage roads and the
  selection's neighbour links (green = same plot, orange = other). Colour modes
  rewrite the tile colour buffers, keeping the shading of the generated colours;
  type and era use `resolveBuilding` on the main thread, filled lazily in 12 ms
  slices. Notes/fallbacks need generation-time data, so that mode (or the "debug
  data" checkbox) regenerates with `debug: true` in the workers; the debug object
  is reduced to notes, facade fallback and summed stage timings right away.
- **Stats**: buildings, roads, skipped counts, read/parse/`buildInputs` time, time
  to first tile, wall time of the last generation round, summed worker time, tiles,
  triangles, vertices, draw calls, FPS, ten slowest tiles, ten slowest buildings
  (from debug timings, or from a "Profile run" that generates every building on the
  main thread in 30 ms slices), failed buildings (OSM id + message, clickable).
- **Trees** ("trees" under View, on by default): Overpass loads always ask for
  trees too (`fetchOverpass(…, { trees: true })`), vector tiles also decode
  `landcover`, so the toggle needs no reload. The data worker places them
  (`trees.ts`) once per origin and clip: `natural=tree` nodes, `natural=tree_row`
  every 8 m, and `landuse=forest` / `natural=wood` ways and complete
  multipolygons filled on a global 11 m grid with hashed jitter (even-odd test on
  the member segments, no ring assembly; cells are deduplicated, so overlapping
  areas and buffered tile copies do not double up). Vector tiles have no single
  trees, only `landcover` class `wood`. Clipped to the load bbox or the file's
  bounds, at most 150,000 trees; drawn as one `InstancedMesh` of a low-poly tree
  (the sim's shape), not pickable. The area line shows the count.
- Light/dark theme follows the system or is forced; colours share the studio's
  variable names.

## Code

`apps/viewer/src`: `main.ts` (wiring), `state.ts` (settings, validation, store; no
DOM/three), `area.ts` (bbox parsing), `area-build.ts` (union of the OSM and tile
results, labels, selection matching), `data.ts` + `data-worker.ts` +
`data-protocol.ts`, `tiles.ts` (pure tiling and the scheduler, tested in
`test/tiles.test.ts`, run with `pnpm --filter @osm-buildingen/viewer test`),
`generation.ts` (scheduler + pool + merge + stats), `generator.ts` (pool, worker
URL), `scene.ts`, `strips.ts`, `picking.ts`, `overlays.ts`, `analysis.ts`,
`profile.ts`, `trees.ts` (tested in `test/trees.test.ts`), `permalink.ts`, `panel-controls.ts`, `panel-inspector.ts`,
`panel-stats.ts`, `dom.ts` (copied from the studio).

The generator worker is created with
`new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' })`;
this resolves in Vite dev and build. `worker.format = 'es'`.

Build workaround: `packages/core` declares `"sideEffects": false` while its index
registers the built-in style packs, so production bundles lost the registration.
`vite.config.ts` marks `packages/core/src/index.ts` as side-effectful (main and
worker bundles) until the package is fixed.

## Measured (Ulm sample, 618 buildings, production build, headless Chromium with SwiftShader, 8 workers)

| Item | Value |
|---|---|
| parse (worker) | ≈ 40–50 ms |
| `buildInputs` (worker) | ≈ 60 ms |
| first tile in scene | ≈ 170–200 ms after inputs |
| all 8 tiles (wall) | ≈ 340–540 ms |
| worker time, summed | ≈ 1.55–1.8 s |
| triangles / vertices | 1,004,607 / 2,006,235 (≈ 1,600 per building) |
| draw calls | 10 (8 tiles, roads, ground) |

The summed worker time is about 4× the single-thread Node figure (≈ 420 ms for all
618): eight cold JITs and the software renderer share the CPU.

## Not done / later

- Picking a tile without a BVH tests every triangle of the hit tiles (fine at this size).
- Per-building timings without debug mode need a timing field from the worker.
- Terrain through `baseElevation`; map-based area picking; blocked-span and
  street-wall overlays (the inspector shows them per building via debug data only
  in the studio).
