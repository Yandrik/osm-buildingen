# OSM adapter (`packages/osm`)

Turns OSM data into `BuildingInput[]`. This is the reference for how a caller
is expected to prepare input.

## Sources

- `.osm` XML (API export), parsed without DOM so it works in workers.
- Overpass JSON (`out body; >; out skel qt;` form).
- Vector tiles (OpenMapTiles schema) are evaluated separately; see
  ../07-open-questions.md.

## Steps

1. **Project** lat/lon to local metres around a caller-given origin.
2. **Collect buildings**: closed ways and multipolygon relations with
   `building=*`; `building:part=*` are attached to the outline that contains
   them (S3DB rule: parts replace the outline's volume).
3. **Tags to attributes**:
   - `height`, `min_height` (units parsed), `building:levels`, `roof:levels`,
     `roof:shape`, `roof:height`, `roof:direction`, `roof:orientation`,
     `building:colour`, `roof:colour`, `start_date`.
   - Type from `building=*` first, then `shop`, `amenity`, `office`,
     `railway`, `public_transport`, `man_made`.
   - Special buildings (`church`, `cathedral`, `chapel`, …) are flagged
     `special` and by default emitted with `detail: 'massing'`.
4. **Addresses**: `addr:housenumber` on the way or on a node inside it.
5. **Groups**: buildings touching each other or within 6 m, where at most one
   has an address, share a `groupKey` (the addressed one's seed). Later this
   can take plot polygons from the caller.
6. **Neighbours**: spatial grid; every building within 3 m of the footprint's
   bounding box is passed as a neighbour, with its resolved height if tagged.
7. **Roads**: `highway=*` ways within 40 m, with a width from `width`, `lanes`
   or class defaults; `tunnel=building_passage` sets `passage`. `railway=rail`
   lines are passed with kind `rail`.
8. **Seed**: hash of quantised footprint plus the tags used above.

## API

```ts
parseOsmXml(text): OsmData
parseOverpassJson(json): OsmData
buildInputs(data, { origin, style, bbox?, margin? }): { inputs: BuildingInput[], meta: BuildingMeta[] }
fetchOverpass(bbox, { endpoint? }): Promise<OsmData>      // separate entry point
```

`meta` carries OSM id, tags and centroid for debugging; it is not needed for
generation.
