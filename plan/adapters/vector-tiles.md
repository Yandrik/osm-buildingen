# Vector tile adapter (`packages/vector-tiles`)

Turns Mapbox Vector Tiles in the OpenMapTiles schema into `BuildingInput[]`,
mirroring the OSM adapter (`adapters/osm.md`). Dependencies:
`@osm-buildingen/core` and `@osm-buildingen/osm` (public API only: the local
projection `createProjection`, `LatLon`, `LatLonBBox`, `MapRoad` types). No
third-party runtime dependency.

## Evaluation (2026-11-22)

Question: can OpenMapTiles-schema tiles replace OSM data as input? **Yes, with
reduced fidelity.** Footprints, heights/levels, addresses (as a yes/no hint),
shops, part volumes and roads survive; roof shapes, building types and the
exact OSM tags do not.

### Sources checked

- MVT 2.1 spec: <https://github.com/mapbox/vector-tile-spec/blob/master/2.1/README.md>,
  `vector_tile.proto` in the same repository.
- OpenMapTiles schema: <https://openmaptiles.org/schema/>, layer definitions in
  <https://github.com/openmaptiles/openmaptiles/tree/master/layers>
  (`building/building.yaml`, `building/building.sql`, `building/mapping.yaml`,
  `building/update_building.sql`, `transportation/transportation.yaml`,
  `housenumber/housenumber.yaml`, `poi/poi.yaml`, `landuse/landuse.yaml`),
  licence in `LICENSE.md` of that repository.
- Planetiler's implementation of the schema (what OpenFreeMap serves):
  <https://github.com/openmaptiles/planetiler-openmaptiles/blob/main/src/main/java/org/openmaptiles/layers/Building.java>,
  `FeatureMerge.java` and `PlanetilerConfig.java` in
  <https://github.com/onthegomap/planetiler>.
- OpenFreeMap: <https://openfreemap.org/>, <https://openfreemap.org/tos/>,
  <https://openfreemap.org/quick_start/>, TileJSON
  <https://tiles.openfreemap.org/planet> (fetched; HTTP 200).
- Protomaps layers: <https://docs.protomaps.com/basemaps/layers>.
- Two real tiles (14/8646/5667 and 14/8646/5668, Ulm centre) from OpenFreeMap,
  decoded with this package.

### What the `building` layer contains

- z13: buildings merged into blocks (`osm_building_block_gen_z13`; Planetiler
  `mergeNearbyPolygons`), no attributes. Not usable.
- z14 (the maximum zoom of the schema; larger zooms are overzoomed by clients):
  one polygon per OSM `building=*` **and** `building:part=*` (both are mapped
  into the same table, `mapping.yaml`), except `location:underground`.
  Attributes, all of them:
  - `render_height = ceil(height ?? levels × 3.66 ?? 5)`,
  - `render_min_height = floor(min_height ?? min_level × 3.66 ?? 0)`
    (`height` also falls back to `building:height`, levels to `building:levels`),
  - `colour` = `building:colour`, else a colour derived from `building:material`,
  - `hide_3d = true` on outlines that are the `outline` member of a
    `type=building` relation. Planetiler can also set it on outlines mostly
    covered by parts (`building_hide_outlines_with_parts`, off by default).
- Not present: roof shape, roof height or colour, levels (only folded into the
  height), building type (`building=*` value), start date, address, name.
  Parts are not marked as parts: a part is indistinguishable from a building
  except by lying inside an outline.
- Ids: the OpenMapTiles SQL uses `osm_id` as the MVT feature id. Planetiler
  merges all z14 buildings with identical attributes into one MultiPolygon
  feature ("reduces the size of some heavy z14 tiles … by 60 %"), which keeps
  one id for the whole group. In the Ulm tile, 2,759 building polygons sit in
  132 features; 1,873 of them in one feature (`render_height` 5). **Feature ids
  are therefore not building ids.**
- Measured in the Ulm tile: 1,873 of 2,759 polygons (68 %) have the default
  `render_height` 5. The others cluster on `ceil(n × 3.66)`: 11 (187), 15 (181),
  8 (169), 19 (67), 4 (57), 22 (40) …, i.e. they come from `building:levels`.

### Other layers

- `transportation`: `class` (motorway, trunk, primary, secondary, tertiary,
  minor, service, track, path, rail, transit, busway, ferry, raceway,
  `*_construction`, …), `subclass` (railway value, or highway value for paths:
  footway, cycleway, steps, pedestrian, platform, corridor …), `brunnel`
  (bridge / tunnel / ford), `ramp` (links), `layer`, `indoor`, `service`,
  `oneway`, `surface`, `access`. No `width` or `lanes`. Pedestrian areas and
  platforms also come as polygons. OSM `tunnel=building_passage` arrives as
  `brunnel=tunnel` (imposm's bool mapping), indistinguishable from real tunnels
  except by `layer`.
- `housenumber` (z14): points with `housenumber`; for buildings the centroid
  is used. Duplicates within a tile with the same street are dropped.
- `poi`: points with `class` / `subclass` (shop, clothing_store, grocery,
  restaurant, cafe, place_of_worship, lodging, railway station, town_hall, …),
  name, `rank`. Polygons become a point on the surface. Buffer 64 px.
  3,678 POIs in the Ulm tile.
- `landuse`: `class` = landuse / amenity / leisure value (residential,
  commercial, industrial, retail, school, hospital, railway, …). In the Ulm
  tile: 61 polygons, mostly pitches and schools, one residential, three
  commercial. Useful only as a weak hint.
- `landcover`, `park`, `water` are not used.

### Geometry

- Extent 4096 at z14. One unit is 40,030 km / 2¹⁴ / 4096 × cos(lat) ≈
  **0.40 m at Ulm** (48.4° N), 0.60 m at the equator. All vertices are snapped
  to that grid.
- Planetiler simplifies at the maximum zoom with 1/16 px = 1 unit tolerance
  (`simplify_tolerance_at_max_zoom` 256/4096), so walls shorter than ~0.4 m
  vanish and nearly straight vertices are dropped. In Ulm, footprint areas
  differ from the OSM areas by 1.6 % on average.
- Overzoom (z15+) adds no information; OpenFreeMap's `maxzoom` is 14.
- Buildings are clipped at the tile edge plus a buffer of 4 px = 64 units
  (≈ 25 m at Ulm). A building is present in every tile whose buffered square it
  touches; one longer than the buffer is cut at the buffer line.
- Merging: z14 polygons are not unioned (only collected into multipolygons);
  touching buildings stay separate rings. At z13 they are unioned.
- Stitching therefore has to work from geometry alone (no ids); see below.

### Providers

- **OpenFreeMap** (<https://openfreemap.org/>): public instance, no key, CORS
  `*`, "no limits on the number of map views or requests", commercial use
  allowed, "The map schema is unmodified OpenMapTiles", tiles made with
  Planetiler. TileJSON `https://tiles.openfreemap.org/planet` (verified) points
  to a dated template, e.g.
  `https://tiles.openfreemap.org/planet/20261115_080022_pt/{z}/{x}/{y}.pbf`
  (`maxzoom` 14, `version` 3.16.0), so clients should go through the TileJSON.
  Tiles are sent gzip-compressed only when the request asks for it. Terms
  (<https://openfreemap.org/tos/>, 2026-10-14): no automated data collection
  "except for offline downloads" of at most 3,000 tiles / 50 MB, at most 4
  parallel requests, unique User-Agent. Required attribution:
  "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (OpenFreeMap part
  optional). Judgement: the viewer loads a handful of tiles per user action to
  display a map, which is the intended use; it stays far below the offline
  limits (cap 36 tiles, 4 parallel). A browser cannot set a User-Agent. This is
  an interpretation, not a statement from OpenFreeMap.
- **MapTiler** (`https://api.maptiler.com/tiles/v3/tiles.json?key=…`): the
  OpenMapTiles schema's maintainer. Without a key the endpoint answers 403
  "Missing key" (verified). Needs an account; not tested.
- **Self-hosted**: Planetiler with the OpenMapTiles profile writes MBTiles or
  PMTiles; OpenFreeMap also publishes weekly planet downloads. Any server that
  serves `{z}/{x}/{y}` works with `tileUrl`. Reading `.pmtiles` archives
  directly (HTTP range requests) is not implemented (follow-up).
- **Protomaps** uses a different schema: layer `buildings` with
  `kind` = building / building_part / address, `height`, `min_height` (in
  metres, not derived from levels), merged buildings up to z14 and individual
  buildings only from z15; roads in `roads` with `kind` / `kind_detail`. It
  would need its own attribute and layer mapping (`layerNames` alone is not
  enough). Not supported.
- Licences: data © OpenStreetMap contributors, ODbL. The OpenMapTiles schema
  design is CC-BY 4.0; products using it must credit "© OpenMapTiles" with a
  link to openmaptiles.org next to "© OpenStreetMap contributors".

### Conclusion

| | OSM adapter | Vector tiles (z14) |
|---|---|---|
| footprint | exact | ~0.4 m grid, simplified, stitched across tiles |
| height | `height`, levels, roof levels/height, min level | `render_height` / `render_min_height` only; levels recovered when the value fits `ceil(n × 3.66)` |
| roof | shape, height, direction, orientation, colour | none (core's style defaults) |
| type | `building=*` + tags | POI and landuse hints only |
| parts | explicit relations + containment | containment + `hide_3d`; part vs. building is a guess |
| address | tag / entrance / node | house number point inside |
| shop | tag / node | POI inside |
| year, material | `start_date` | none (`colour` from material) |
| roads | widths from `width` / `lanes` / class | class default widths |
| passage | crossing or `tunnel=building_passage` | crossing, not bridges |

Recommendation: implement it as a second input source for when no OSM extract
or Overpass is available, or for larger areas (tiles are cached by CDNs,
Overpass is not). For anything where roofs and types matter, OSM stays the
better source.

## API

```ts
// @osm-buildingen/vector-tiles
decodeTile(bytes: Uint8Array, z, x, y, { layers? }): DecodedTile   // MVT 2.1, uncompressed
featurePolygons(feature): TilePolygon[]       // rings grouped by signed area
buildInputsFromTiles(tiles: DecodedTile[], {
  origin?: LatLon,            // default: centre of bbox, else of the tiles
  style: StyleInput,
  bbox?: LatLonBBox,          // emit only buildings whose centroid is inside
  seed?: string | number,
  shopProbability?: number,
  maxNeighbours?: number,     // 16
  maxRoads?: number,          // 12
  layerNames?: Partial<LayerNames>,
  levelsHeuristic?: boolean,  // default true
}): { inputs, meta: VectorBuildingMeta[], origin, roads: VectorRoad[], stats }
tilesForBBox(bbox, z) / lonToTileX / latToTileY / tileXToLon / tileYToLat / tileBBox / unitSize

// @osm-buildingen/vector-tiles/fetch  (the only module that touches the network)
fetchTiles({ tileUrl | tileJson, bbox, zoom = 14, apiKey?, signal?, maxTiles = 36,
             concurrency = 4, layers?, onProgress? }): Promise<{ tiles, zoom, template, attribution, bytes, missing }>
fetchTileJson(url, { apiKey?, signal? }), TileFetchError { status, retryable }
OPENFREEMAP_TILEJSON, OPENMAPTILES_ATTRIBUTION
```

`DecodedTile` is plain data (posted from the data worker). `meta[i]` belongs to
`inputs[i]`: stable `key` (base36 of the seed without the global seed), tile
properties, tiles used, `stitched`, `truncated`, centroid, area, `special`,
`type`, `typeReason`, `heightSource` (levels / height / default), `groupKey`,
part count, house numbers, POIs and landuse found.

## Steps

1. **Decode** (`src/pbf.ts`, `src/mvt.ts`): a ~150-line protobuf reader
   (varint, zig-zag, fixed32/64, length-delimited) and the MVT schema. Chosen
   over `@mapbox/vector-tile` + `pbf` because the format is small and the repo
   avoids runtime dependencies; it runs unchanged in workers and Node. Layers
   not asked for are skipped by reading only their name. Points are y-down tile
   units; polygon rings are split by signed area (exterior positive with y
   down, MVT 2.1 §4.3.4.4); reversed-winding tiles are detected by the first
   ring. Gzipped input is refused with a clear error (fetch decompresses).
2. **World units**: x = tileX × extent + px, Y = −(tileY × extent + py). Every
   tile of one zoom shares this frame with integer vertices. Y is negated so
   that the MVT exterior becomes counter-clockwise after reversing.
3. **Stitching** (`src/stitch.ts`):
   - Each polygon is clipped (Sutherland–Hodgman, intersections rounded to
     units) to its own tile square, only on sides where the neighbour tile is
     loaded. This removes buffer copies (a building entirely in a neighbour's
     buffer disappears there) and cuts crossing buildings exactly on the
     border. On sides without a loaded neighbour the buffer is kept.
   - Pieces with edges on the same border line, from different tiles,
     overlapping by more than half a unit along the line, with identical
     properties, are joined (union-find).
   - A group is merged by edge cancellation: border vertices within 1 unit are
     snapped together, border edges are split at every group vertex on the
     line, opposite directed edges cancel, the rest is re-linked into rings
     (sharpest left turn at pinch points), and vertices on border lines in
     straight runs are removed, so the stitched ring equals the original one.
     Zero-width Sutherland–Hodgman bridges of concave shapes cancel the same way.
   - `truncated`: a polygon reaching the buffer edge (measured from the tile,
     at least the schema's 64 / 4096) on a side without a loaded neighbour.
   - Limits: buildings that meet exactly along a tile border with equal
     properties are merged into one; border vertices that disagree by more than
     1 unit between tiles leave a small notch; all tiles must have the same zoom.
4. **Project** each vertex world unit → lat/lon (Web Mercator inverse) →
   local metres with the OSM adapter's `createProjection` (equirectangular,
   mean earth radius, x east, y north). Rings are cleaned and wound like the
   OSM adapter (outer CCW, holes CW). Footprints < 0.1 m² are dropped, buildings
   < 1 m².
5. **Parts**: a polygon whose interior point lies inside a larger polygon
   (holes respected) belongs to the smallest such polygon; chains are flattened
   to the top-level outline. The outline becomes the `footprint`, the contained
   polygons `parts`. An outline without `hide_3d` is also added as its own part
   when its parts cover less than half of it (the tiles cannot tell
   "outline" from "outline that is also a part"; mirrors Planetiler's coverage
   rule). Alternative considered: separate buildings sharing a `groupKey`;
   rejected because overlapping volumes would double walls and core already
   has the S3DB part model.
6. **Attributes** (`src/attributes.ts`): `render_height` 5 with
   `render_min_height` 0 is the schema default and is not passed (core infers).
   With `levelsHeuristic`, a height equal to `ceil(n × 3.66)` (and a minimum
   height equal to `floor(m × 3.66)`) becomes `levels = n − m` (buildings) or
   `levels = n, minLevel = m` (parts), because OSM `height` includes the roof
   while levels do not, and core adds a roof on top of levels. Otherwise
   `height` / `minHeight` in metres. A tagged height that happens to fit the
   formula (11 m, 15 m …) is read as levels too. `colour` → `colours.wall`.
7. **Hints** (`src/hints.ts`, tables): house number point inside →
   `hasAddress`. POIs inside (each tile's own square only): `place_of_worship`,
   `castle` on ≥ 80 m² → special (massing); railway station / bus station /
   ferry terminal → station; town_hall, school, hospital, university, college,
   library → office; hotel / hostel / guest house → apartments; shop-like
   classes (shop, clothing_store, grocery, bakery, restaurant, cafe, bar, bank,
   …) → `shop: true` and, without another type, townhouse (≥ 3 levels or
   ≥ 10 m, or dense row, < 1500 m²) else store — the OSM adapter's rule.
   Office POIs are ignored (usually tenants). Landuse of the smallest landuse
   polygon containing the footprint: industrial ≥ 150 m² → industrial,
   retail ≥ 300 m² → store, commercial ≥ 300 m² → office, school / university /
   college / hospital ≥ 200 m² → office, garages ≤ 120 m² → garage.
8. **Groups, neighbours, roads** as in the OSM adapter (code copied, see
   below): groups within 6 m refusing two addressed buildings,
   `groupKey = "vt-" + base36(leader seed)`; neighbours within 3 m with the
   best height estimate (`render_height` unless default; for outlines with
   parts the tallest part). Roads from `transportation` lines clipped to their
   own tile: widths by class (motorway 20, trunk 14, primary 10, secondary 8,
   tertiary 7, minor / busway 6, service 4, track 3, ramps 5; paths by
   subclass: pedestrian 6, footway / cycleway / steps / bridleway 2, path 1.5;
   rail / transit by subclass: rail 3.5, light_rail / narrow_gauge 3, tram 2.5).
   Dropped: construction, ferries, piers, platforms, corridors, `indoor`,
   `layer < 0`. Tunnels on layer ≥ 0 are kept (building passages).
   `passage` when a piece runs through the interior and `brunnel` is not
   `bridge`. Of the pieces near a building, passages come first, then the
   nearest; `maxRoads` keeps 12.
9. **Seed**: the OSM adapter's scheme from lat/lon (vertices relative to the
   ring mean, 0.1 m, CCW from the smallest point; position in 1e-6°; plus
   `render_height`, `render_min_height`, `colour`, `hide_3d`). It does not
   depend on the origin, tile order, feature order or on which tile a piece
   came from: a building read whole from one tile's buffer and the same
   building stitched from two tiles get the same seed (tested). It differs from
   the OSM adapter's seed for the same building (tile geometry is quantised)
   and between providers or zooms with different quantisation.
10. **Order**: buildings sorted by seed (then area), so the result does not
    depend on tile order.

## Fetching

`fetchTiles` computes the tile range of the bbox at the zoom (clamped to the
TileJSON `minzoom` / `maxzoom`), refuses more than `maxTiles` (36), loads with
4 requests in flight, treats 404 / 204 as empty tiles, gunzips bodies that
still start with the gzip magic (static hosting without `Content-Encoding`),
and decodes only the five layers the adapter reads. `apiKey` replaces `{key}`
or is appended as `key=` (MapTiler style). TMS (`{-y}`) and `{s}` subdomain
templates are not supported.

## Measured: Ulm centre (OSM fixture bounds 48.39654,9.98813 – 48.40006,9.99593)

Tiles 14/8646/5667 and 14/8646/5668 from OpenFreeMap (623 KB uncompressed),
same bbox passed to both adapters (`tools/town-tiles.ts` vs `tools/town.ts`):

| | OSM fixture | vector tiles |
|---|---|---|
| buildings | 582 | 582 (all within 2 m of an OSM centroid) |
| levels / height known | 182 / 3 | 180 / 3 (all 180 levels equal OSM's) |
| roof shape | 114 | 0 |
| type set by adapter | 307 | 232 |
| special | 4 | 3 |
| with parts | 10 | 10 |
| addressed | 372 | 362 |
| shop | 244 | 219 |
| colour | 54 | 58 (material colours added) |
| passage | 41 | 42 |
| plot groups | 377 | 373 |

Mean relative footprint area difference 1.6 %. 49 piece groups were stitched
across the shared border. `buildInputsFromTiles` ≈ 200 ms for both tiles
(5,292 polygons read), decoding ≈ 40 ms (Node 24).

Look (software renders compared side by side): the same town plan, courtyards
and street walls; levels match. Differences: all roofs are core's defaults, so
modern flat-roofed blocks get pitched roofs and some pitched ones are flat;
`building=apartments` / `office` / `school` are lost, so big blocks are
guessed by size; the Minster is built from its 61 parts with flat tops (its
spires and roof shapes are roof tags in OSM), so towers become prisms;
garages and sheds are not recognised.

## Code shared with the OSM adapter (copied, candidates for a shared package)

`src/geometry.ts` (box, area, centroid, point-in-polygon, distances,
`clipPolyline`, `cleanRing`, `withWinding`, `GridIndex`), the seed ring key
(`src/seed.ts`), `assignGroups` / `leaderRank`, `crossesInterior` and the
`roadsNear` loop (`src/build.ts`). `packages/osm` exports none of these; a
private `packages/geo` (or exporting them from `osm`) would remove the copies.

## API gaps noticed

- Core has no `minLevel` on `BuildingInput` (only on parts), so a building with
  a minimum level gets `minHeight` in metres from the schema's 3.66 m.
- Core cannot be told that a height excludes the roof; that is why levels are
  reconstructed from `render_height`.
- `@osm-buildingen/osm` does not export its earth radius or geometry helpers.
- The viewer's `MapRoad` (OSM) requires `osmId`; the scene now takes
  `Pick<MapRoad, 'line' | 'width' | 'kind'>`.

## Not done / follow-ups

- PMTiles archives (range requests, directory decoding).
- Protomaps schema (different layers and attributes).
- Tiles of mixed zooms; z13 fallback.
- Stitching is exact only for pieces whose border vertices agree within 1 unit.
- Heights read as levels when a tagged height fits `ceil(n × 3.66)`.
