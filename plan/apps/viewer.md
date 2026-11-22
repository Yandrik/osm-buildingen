# Viewer (OSM area debugger)

Purpose: see the generator on real areas, find bad cases, measure.

## Features

- Load: drop an `.osm` file, or enter a bounding box / pick on a map and load
  through Overpass (with a clear error when the server is busy).
- Area is cut into tiles (default 250 m); buildings are generated in a worker
  pool and merged per tile.
- Controls: region, modernity, global seed, detail level, townhouse store
  probability.
- Debug overlays: building type, plot groups, blocked wall spans, street
  walls, passages, fallbacks (roof or facade), era.
- Click a building: OSM tags, the exact `BuildingInput` as JSON, resolved
  spec, link "open in studio" (input encoded in the URL).
- Stats: buildings, triangles, generation time per tile and per building
  (worst ten listed).
- Ground: flat plane with roads drawn as strips. Terrain from the caller's
  elevation source comes later through `baseElevation`.

## Stack

Vite, three.js, plain TypeScript with a small UI layer (no framework unless
the UI outgrows it).
