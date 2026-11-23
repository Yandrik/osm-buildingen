# Sim (bike / car / plane over real terrain)

Purpose: a cell-shaded, terrain-accurate ride-around of a real area, and a stress test of
streaming the generator at city scale. Currently the Paris area,
`1.8621, 48.6478, 2.8612, 49.0936` (lon/lat). `pnpm sim` → http://localhost:5175
(preview 4175; both listen on the LAN so phones can connect).

## Data (local, gitignored: `apps/sim/data/`)

| Path | Content |
|---|---|
| `terrain/idf-terrain.pmtiles` | Mapterhorn terrarium webp, 512 px, z0–16, bbox extract (2.2 GB) |
| `osm/tiles/14/x/y.json` | Geofabrik free shapefile layers cut into z14 tiles, local metres (see `osm/README.md`) |
| `osm/buildings/14/x/y.json` | Buildings with OSM tags and their `building:part`s from the full Île-de-France `.pbf` (`scripts/osm_buildings.py`, pyosmium + shapely, ~4 min). Same tile frame. Optional: without it the shapefile buildings are used |
| `osm/spill/14/x/y.json` | Area polygons of other tiles that reach into this one (`pnpm --filter @osm-buildingen/sim prepare-data`) |

The Vite config serves `data/` under `/data` with HTTP range support (pmtiles needs it).
It is not copied into the build; a deployment hosts it next to the build output.

### Static publication

Live unlisted deployment: https://pub.cool2.yandrik.dev/paris-ride/ .
The initial deployment's 139 terrain segments reassemble byte-identically to the
source archive. Published file sizes, sampled beginning/middle/end terrain ranges,
gzip JSON bytes and real 404s were verified. Desktop and phone-layout Chromium
smoke tests loaded terrain/buildings, exercised help/vehicle/camera controls and
accelerated the car without JS or network errors. Existing Caddy gzip is active;
custom server Cache-Control headers still require access to the Caddy site config.

`pnpm --filter @osm-buildingen/sim prepare-site <new-directory> /paris-ride/`
stages the production build and only its runtime data. No Node/backend process is
needed online. The host must support HTTP byte ranges for the PMTiles archive and
serve missing tiles as real 404s (not an SPA HTML fallback).

The staging script hashes runtime data into `data/<snapshot>/`, gzip-compresses JSON
as explicit `.json.gz` files, and builds with Vite's subdirectory base. Workers use
`BASE_URL`, optionally overridden by `VITE_SIM_DATA_URL`; `VITE_SIM_DATA_GZIP=true`
enables stream decompression, and `VITE_SIM_DATA_IMMUTABLE=true` permits reuse of
cached JSON via `force-cache`. Local development uses ordinary uncached-by-policy
JSON paths. Terrain remains uncompressed at the HTTP layer so byte offsets stay valid.
Keep old snapshots and hashed JS assets while older tabs may still be open.

Production hosting should set `Cache-Control: public, max-age=31536000, immutable`
on hashed assets and snapshot data; HTML should revalidate. Explicit gzip JSON
works without server compression configuration (do not set Content-Encoding on
these already-compressed files). PMTiles uses its normal range/ETag handling.
There is no service worker or eager whole-region download.
Single-file uploads of the 2.3 GB terrain archive timed out on the publishing
endpoint, so staging splits it into 16 MiB byte-identical `.bin` segments.
`ChunkedSource` implements the PMTiles source interface and reassembles only ranges
crossing segment boundaries. Per-segment HTTP ranges remain essential; individual
segment ETags are not exposed as an archive-wide ETag. The immutable snapshot URL
identifies the archive. Local development retains the single-file source.
The sim's data-loader tests cover subdirectory and external data URLs, gzip
decoding, immutable fetch policy, missing tiles, and corrupted compressed data.
Segment-source tests cover boundary crossings, final partial segments, clipping,
cancellation and truncated responses.

## Frame

The OSM tiles use a uniformly scaled Web Mercator (k = 1608.9 m per z14 tile), so a z14
terrain tile and a z14 OSM tile cover exactly the same square. World metres: east/north
from the SW corner of tile (8276, 5650); three.js X = east, Z = -north (`world/frame.ts`).
Scale error against the ground is ±0.4 % at the bbox edges.

## Streaming

- **Tile workers** (2 on mobile, 4 on desktop, `tile-worker.ts`): one tile always goes to
  the same worker so its parsed JSON and decoded terrain stay cached there. Requests:
  `terrain` (257² height grid), `paint` (ground texture at a size), `detail` (building
  inputs per cell, trees, bridge decks), `far` (z12 heights).
- **Terrain**: one mesh per z14 tile, grid stride by distance (6.3 m within 600 m, then
  12.6 / 25 / 50 m) with 25 m skirts against cracks. A coarse z12 layer covers the whole
  bbox; its shader discards fragments over tiles that have a z14 mesh (mask texture).
- **Ground texture**: roads, rails, landuse, water and building footprints are painted
  into a per-tile canvas (4096 px within 150 m, 2048 within 600 m, then 1024 / 512 / 256), so roads follow the
  terrain exactly. Tunnels and bridges are not painted.
- **Buildings**: ~200 m cells (8 × 8 per tile). Every cell within the building distance
  (default 350 m; `?bldg=metres` or the slider in the help panel, kept in localStorage;
  growing with altitude up to 2.6 km when flying) is generated as `detail: 'massing'`.
  A cell within the HQ distance of the player (default **200 m**; `?hq=metres` or the
  separate HQ distance slider, 50–1000 m in 25 m steps, saved in localStorage) is
  generated at `full` detail and swapped in. HQ uses 3D distance and is capped by
  the overall building radius; full cells leave again 60 m beyond the entry radius
  to prevent flicker. Slider changes apply on the next streaming update. The
  massing mesh is kept hidden so dropping back is instant. Full cells are split in
  batches of 24 across the generator pool.
- **Trees**: OSM tree points plus a jittered 11 m grid in forests, instanced, within
  900 m (300 m on mobile). Forests also get a stipple in the ground texture.
- **Bridges**: roads and rails with `bridge=T` become deck meshes; deck height is the
  linear interpolation of the terrain at the two ends plus a small arch.

## Building inputs

`world/inputs.ts` uses the OSM adapter's tag rules (`readAttributes`, `partInput`,
`classify`, `specialReason`, `estimateHeight`, exported from `@osm-buildingen/osm`), so a
building gets the same height, levels, roof, colours, parts and type here as in the
viewer. Special buildings (churches, towers, `triumphal_arch`, …) stay at massing detail
like in the adapter; their shape comes from their parts (the Arc de Triomphe's vaults are
parts with `min_height`). Parts join the smallest building containing their
point-on-surface in preprocessing; parts outside any building become buildings of their own.

Where height and levels are missing (and there are no parts), cells with more than 33 %
building coverage within 7.5 km of the centre get Haussmann defaults for untyped /
apartment buildings over 70 m²: 5–7 levels, and unless tagged mansard roofs, cream walls,
zinc roofs, shops likely. Other dense cells get 3–6 level apartments. Modernity rises
with distance from the centre. The Eiffel tower is a hand-built model
(`world/landmarks.ts`); its footprint is skipped.

Without `data/osm/buildings` the worker falls back to the shapefile's `buildings_a`,
which has only `building=*` and the name.

## Rendering

`MeshToonMaterial` with a 3-band gradient everywhere. Every toon material also writes its
view-space normal to a second colour attachment (`writeNormals`, multiple render targets,
4× MSAA on desktop). The outline post pass inks:

- creases: neighbouring normals more than ~50° apart, within 400 m. Normals do not change
  with distance, so these lines stay still while moving; tree-crown facets stay unlined.
- silhouettes: a depth step (> 3 %) that is also a kink in 1/view distance (decoded from
  the log depth buffer). Planes have zero Laplacian in 1/distance, so grazing ground is not
  inked. Only the near side of a step is inked.

Lines are sampled `round(1.25 × devicePixelRatio)` pixels apart so they keep their size
on high-DPI screens. `?outlineDebug=1` shows the normal buffer, `=2` the edge mask.

Shadows (desktop only): 4096² map over a box of 140 m (growing to 1.4 km with altitude),
centred ahead of the camera on the ground and moved in whole shadow texels so edges do
not crawl. The tile under the player gets a 4096 px ground texture (~0.4 m texels).

## Vehicles and physics

Arcade, in `vehicles/vehicles.ts`. Ground vehicles move along their heading, follow the
terrain or a bridge deck within 1.5 m above, pitch and roll from four ground samples,
get slope acceleration, hold still on slopes when no key is pressed, and are pushed out
of building footprints (sliding along walls on glancing hits). The bike leans into
turns. The plane has throttle, pitch / roll / yaw rates scaled with airspeed, a
coordinated-turn yaw from bank, stall sink and nose drop below 26 m/s, take-off and
gentle landings on any ground, and crashes (respawn 250 m up) on hard contact or inside
a building volume.

Controls: keyboard (see the in-app help, `H`) and on touch devices a stick plus pedals
(ground) or throttle buttons (plane). URL: `?at=lon,lat,bearing&v=car|bike|plane&cam=far|cockpit`,
`?mobile` forces the touch layout, `?nooutline`.
The HUD is stacked above touch controls so the help panel's close button remains
reachable on narrow phone screens.

## Open

- Far field outside the z14 radius is plain colour; a low-res painted texture would help
  from altitude.
- Building neighbours and roads are only looked up inside the building's own tile.
