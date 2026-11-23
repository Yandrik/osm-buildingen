# Paris Ride (sim)

Cell-shaded bike / car / plane sim over real terrain (Mapterhorn) and OpenStreetMap
buildings, generated on the fly by `@osm-buildingen/core`. Design notes: `plan/apps/sim.md`.

```sh
pnpm sim            # http://localhost:5175 (also on the LAN for phones)
```

## Data (not in git, `apps/sim/data/`)

Terrain, Mapterhorn z0–16 for the bbox `1.8621,48.6478,2.8612,49.0936`:

```sh
B=1.8621,48.6478,2.8612,49.0936
pmtiles extract --bbox=$B https://download.mapterhorn.com/planet.pmtiles planet.pmtiles
pmtiles extract --bbox=$B --maxzoom=16 https://download.mapterhorn.com/6-32-21.pmtiles a.pmtiles
pmtiles extract --bbox=$B --maxzoom=16 https://download.mapterhorn.com/6-32-22.pmtiles b.pmtiles
pmtiles merge planet.pmtiles a.pmtiles b.pmtiles data/terrain/idf-terrain.pmtiles
```

OSM, from the Geofabrik Île-de-France free shapefile zip (Python venv with
`data/osm/scripts/requirements.txt`):

```sh
python -I data/osm/scripts/osm_extract.py ile-de-france-latest-free.shp.zip data/osm
pnpm prepare-data   # spill files for polygons that cross tile borders
```

Buildings with their 3D tags and `building:part`s, from a full `.osm.pbf` of the region
(pyosmium + shapely + numpy):

```sh
python -I scripts/osm_buildings.py ile-de-france-latest.osm.pbf data/osm/buildings
```

Terrain © Mapterhorn. Map data © OpenStreetMap contributors (ODbL), extract by Geofabrik.

## Static deployment

Published (unlisted): https://pub.cool2.yandrik.dev/paris-ride/

```sh
pnpm --filter @osm-buildingen/sim prepare-site /tmp/opencode/paris-ride-site /paris-ride/
```

Use a new output directory. Upload its contents under `/paris-ride/` on a static
HTTPS host with HTTP byte-range support. The directory contains the app, a
content-addressed terrain/OSM snapshot, and `deployment.json`; preprocessing files
are excluded. JSON is precompressed and decoded in browser workers, independent of
server compression settings. Runtime requires a modern WebGL2 browser with
OffscreenCanvas and DecompressionStream support.

Terrain is split byte-for-byte into 16 MiB segments named
`data/<snapshot>/terrain/idf-terrain.pmtiles/0000.bin`, etc. The range reader stitches
only requested bytes, including ranges crossing segment boundaries. This avoids
multi-gigabyte upload timeouts without changing the archive or adding a backend.
Local development still reads the original `.pmtiles` file. The staging build sets
`VITE_SIM_TERRAIN_CHUNK_BYTES` and `VITE_SIM_TERRAIN_BYTES`.

Workers follow the Vite build base instead of assuming origin-root `/data`.
Advanced builds can set `VITE_SIM_DATA_URL`, `VITE_SIM_DATA_GZIP=true`, and
`VITE_SIM_DATA_IMMUTABLE=true`; the staging command sets these automatically.
See `plan/apps/sim.md` for caching policy. Preserve older hashed assets and data
snapshots until existing sessions no longer need them.

For Caddy, add these directives inside the existing public site's block (publishing
files alone cannot change server configuration):

```caddyfile
@parisImmutable path /paris-ride/assets/* /paris-ride/data/*
header @parisImmutable Cache-Control "public, max-age=31536000, immutable"
@parisEntry path /paris-ride/ /paris-ride/index.html /paris-ride/deployment.json
header @parisEntry Cache-Control "no-cache"
```

Normal Caddy `encode gzip`/`encode zstd gzip` can compress JS/CSS/HTML. Leave
`.pmtiles` and `.json.gz` files without an added `Content-Encoding`; their binary
representation is consumed directly by the range reader / gzip decoder. The
client's immutable JSON cache policy works even without these optional headers.
