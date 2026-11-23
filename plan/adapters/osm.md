# OSM adapter (`packages/osm`)

Turns OSM data into `BuildingInput[]`. This is the reference for how a caller
is expected to prepare input. Only dependency: `@osm-buildingen/core` (public API).

## API

```ts
// @osm-buildingen/osm
parseOsmXml(text: string): OsmData              // .osm XML (API map call, JOSM, Overpass out:xml)
parseOverpassJson(json: unknown): OsmData       // Overpass [out:json]
buildInputs(data: OsmData, {
  origin?: LatLon,              // default: centre of data.bounds, else of all nodes
  style: StyleInput,            // applied to every building
  bbox?: LatLonBBox,            // emit only buildings whose centroid is inside
  seed?: string | number,       // global seed mixed into every building seed
  shopProbability?: number,     // passed through to every input
  maxNeighbours?: number,       // default 16
  maxRoads?: number,            // default 12
}): { inputs, meta, origin, roads: MapRoad[], stats }
createProjection(origin) / project(latLon, origin) / unproject(xy, origin)
parseLength / parseLevels / parseDirection / parseYear / parseRoofShape
// The tag rules on their own, for sources with already assembled, tagged polygons
// (the sim's pre-tiled extract): the same results as inside buildInputs.
readAttributes(tags) / estimateHeight(attrs) / partInput(footprint, attrs)
classify(tags, ctx) / skipReason(tags) / specialReason(tags)

// @osm-buildingen/osm/overpass  (the only module that touches the network)
fetchOverpass(bbox, { endpoint?, signal?, timeout? }): Promise<OsmData>
overpassQuery(bbox, timeout?): string
OverpassError { status, retryable }   // 429, 503/504, "runtime error" remarks
```

`OsmData` is plain arrays (`nodes`, `ways`, `relations`, optional `bounds`), so it
can be posted to a worker. `meta[i]` belongs to `inputs[i]`: OSM type and id,
ring index (multipolygons with several outers give one input per outer),
tags, centroid (local and lat/lon), area, `special`, chosen `type` and a short
`typeReason`, `groupKey`, attached part ids. `roads` are all accepted
highway/rail lines in local metres for drawing. `stats` counts skipped elements.

Inputs and meta are sorted by (way before relation, id, ring), so the result
does not depend on element order.

## Parsing

- XML: a hand-written scanner (indexOf over the text, no tree, no DOMParser),
  works in workers and Node. Handles comments, `<?xml?>`, entities, both quote
  styles, `>` inside attribute values, `action="delete"` / `visible="false"`
  (dropped), osmosis `<bound box>`. Throws when there is no `<osm>` element.
- Overpass JSON: `out body; >; out skel qt;` and `out geom` for ways (missing
  nodes are created from the inline geometry). Relation member geometry from
  `out geom` without the member ways is not supported.

## Steps

1. **Project** lat/lon to local equirectangular metres around the origin
   (x east, y north, mean earth radius).
2. **Collect buildings**: closed ways and `type=multipolygon` relations with
   `building=*`. Multi-way rings are joined at shared end nodes; rings that do
   not close are dropped. Inner rings become `holes` of the outer that
   contains them. Outer member ways of a building relation are not emitted
   again. Old-style multipolygons (tags on the outer way) still get their holes.
   Rings are cleaned (closing point, duplicates < 1 cm, A-B-A spikes),
   outer CCW, holes CW. Footprints below 1 m² are dropped (core rejects < 0.5 m²).
   - Skipped (`stats.skippedByTag`): `building=no|none|proposed|construction|
     demolished|destroyed|razed|removed|not_built`, `location=underground|underwater`.
     Construction is skipped because the outline is often the site and the
     finished look is unknown.
3. **Parts**: `building:part=*` ways and multipolygons (min. 0.1 m², pillars
   exist) go to the building named by a `type=building` relation, else to the
   smallest building whose outline contains the part's interior point. An
   outline that is also tagged `building:part` is added as its own part when
   it has other parts. `PartInput.levels` / `minLevel` keep the S3DB meaning
   (counted from the ground); `minHeight` only when `min_height` is tagged.
4. **Tags to attributes**:
   - `height`, `min_height`, `roof:height`: `12`, `12 m`, `12.5m`, `12,5`, `40 ft`,
     `12'`, `12'6"`; garbage, negative and > 1000 m are ignored. A
     `min_height` ≥ `height` or `roof:height` ≥ `height` is dropped.
   - `building:levels` (fractions rounded), `roof:levels`, `building:min_level`.
     For buildings, S3DB levels are converted: `levels = building:levels −
     min_level`, and `minHeight = min_level × 3 m` when `min_height` is missing
     (BuildingInput has no `minLevel`).
   - `roof:shape`: flat, gabled (+ pitched, saltbox, crosspitched,
     cross_gabled), hipped (+ side_hipped), half-hipped (+ half_hipped),
     pyramidal (+ pyramid), skillion (+ lean_to, monopitch), gambrel, mansard.
     Anything else (dome, onion, round, many, …) → undefined.
   - `roof:direction`: degrees or N, NNE, … NNW → degrees [0, 360).
     `roof:orientation` along/across → `roof.ridge`.
   - `building:colour` → `colours.wall`, `roof:colour` → `roof.colour` (strings
     passed through, core parses).
   - `start_date` → `year`: `1993`, `1993-05-01`, `~1890`, `ca. 1890`, `1890s` (1895),
     `C19` (1850), `early/mid/late C19` (1815/1850/1885), `19th century`,
     ranges `1890..1900` / `1890-1900` (midpoint), `before/after 1900` (∓10).
5. **Type** (tables in `src/classify.ts`):
   - Special first (`SPECIAL_BUILDING`, `SPECIAL_TAG`): church, cathedral,
     chapel, basilica, mosque, synagogue, temple, shrine, religious, monastery,
     castle, palace, fort, tower, bell_tower, water_tower, transformer_tower,
     silo, bunker, ruins, stadium, grandstand, triumphal_arch, gatehouse; or
     `amenity=place_of_worship`, `man_made=tower|water_tower|chimney|lighthouse|
     silo|cooling_tower|storage_tank`, `historic=castle|city_gate|tower|fort|
     monastery|church|ruins|citywalls`, `leisure=stadium`, `ruins=yes`.
     → `meta.special`, `detail: 'massing'`, type left to core.
   - `building=*` (`BUILDING_TYPE`): house/detached/semidetached_house/bungalow/
     farm/cabin/villa → house; residential → apartments from 250 m² or 4
     levels, else house; apartments/dormitory/flats/hotel → apartments;
     terrace/townhouse → townhouse; garage/garages/carport → garage;
     shed/hut/allotment_house/roof/greenhouse/toilets/service/container → shed;
     office/government/public/civic/school/college/university/kindergarten/
     hospital/fire_station/townhall/commercial → office; industrial/warehouse/
     manufacture/factory/hangar/barn/farm_auxiliary/stable/cowshed/sty/parking/
     sports_hall → industrial; retail/supermarket/kiosk/shop → store;
     train_station/transportation → station.
   - `building=yes` and unknown values (`OTHER_TYPE`, in order):
     `railway=station|halt`, `public_transport=station`,
     `amenity=bus_station|ferry_terminal` → station; `office=*` → office;
     civic amenities (townhall, library, school, hospital, bank, theatre, …) →
     office; `tourism=hotel|hostel|guest_house` → apartments;
     `amenity=parking`, `man_made=works`, `industrial=*` → industrial.
   - Shops: `shop=*` (or a shop-like amenity: restaurant, cafe, fast_food, bar,
     pub, ice_cream, bank, pharmacy, bureau_de_change) on the building or on a
     node inside it sets `shop: true`. Without another type: townhouse with
     shop when ≥ 3 levels or the building touches ≥ 2 others (dense row) and
     is < 1500 m²; otherwise store.
   - Nothing matched → `type` undefined, core guesses from size.
6. **Addresses**: `addr:housenumber` on the building, on an outline vertex
   (entrance), or on a node inside the footprint → `hasAddress`.
7. **Groups**: pairs of buildings within 6 m (outline distance, 0 when
   overlapping) are unioned nearest first (ties by canonical order); a union
   is refused when both sides already contain an addressed building.
   `groupKey = "osm-" + base36(seed of the leader)`, leader = the addressed
   building, else the largest. Every building gets a key, also when alone, so
   mapping a shed later does not change the house.
8. **Neighbours**: grid index (50 m cells); every building whose outline is
   within 3 m of this outline, nearest first, at most 16. `footprint` is the
   neighbour's outer ring; `height` from `height`, else `building:levels × 3 m
   + roof:height` (or `roof:levels × 2.7 m`), else the tallest part;
   `sameGroup` when in the same plot group.
9. **Roads**: `highway=*` and `railway=rail|light_rail|tram|narrow_gauge`.
   Skipped: `area=yes`, `indoor=yes`, `layer<0`, tunnels other than
   `building_passage`, values not in the tables (proposed, construction,
   platform, corridor, …). Per building, the lines are clipped to the
   footprint's bounding box + 40 m, pieces farther than 40 m from the outline
   are dropped, nearest 12 kept. `passage` when the piece runs through the
   footprint's interior (not along a wall), or for `tunnel=building_passage`
   within 1 m.
   Widths (`src/roads.ts`): `width` tag > `lanes × 3 m` > class default:
   motorway 20, trunk 14, primary 10, secondary 8, tertiary 7, *_link 5,
   unclassified/residential/road/busway 6, living_street 5, service 4, track 3
   (kind `road`); pedestrian 6, footway/cycleway/steps/bridleway 2, path 1.5
   (kind `path`); rail 3.5, light_rail/narrow_gauge 3, tram 2.5 (kind `rail`).
10. **Seed**: `seedFrom(globalSeed, position, footprint, tags)`. Footprint =
    vertices in metres relative to the outer ring's lat/lon mean, quantised to
    0.1 m, CCW, starting at the smallest vertex (holes likewise, sorted);
    position = that mean in 1e-6 degrees. Computed from lat/lon, so it does
    not depend on the origin, element order or the extract's cut; not the OSM
    id. The position is included because identical prefab houses would
    otherwise share a seed. Tags: values of `SEED_TAGS` in `src/seed.ts`.

## Performance (Node 24, one core)

- Ulm fixture (2.4 MB, 6.7k nodes, 1.3k ways): parse ≈ 30 ms,
  `buildInputs` ≈ 50 ms warm (≈ 80 ms first call).
- 12 MB XML (33k nodes, 6.5k ways): parse ≈ 95 ms.
- Fixture tiled 3 × 2 (3,708 buildings, 2,982 highways, 40k nodes):
  `buildInputs` ≈ 330 ms.

## Not done / open

- Core builds `parts`; special buildings are still emitted with `detail: 'massing'`.
- `roof:angle`, `building:material`, `roof:material` are not read.
- `building=roof`, `carport` and similar open-sided roofs map to the `canopy`
  type; `roof:shape=sawtooth` is passed through.
- `roof:shape` dome, onion, cone and round are passed through; saltbox
  variants, sawtooth and butterfly map to their closest relative.
- Vector tiles (OpenMapTiles schema) have their own adapter; see
  [vector-tiles.md](vector-tiles.md).
- Groups come only from distance and addresses; plot polygons
  (`landuse`, cadastre) could replace this later.
