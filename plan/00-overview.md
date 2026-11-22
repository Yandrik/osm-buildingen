# Overview

## Goal

Given a building footprint and whatever is known about the building, produce a
believable low-poly 3D model, fast enough to generate live while map tiles load.

- The footprint is respected exactly. Tagged height, levels and roof shape are
  respected when given; everything missing is inferred deterministically.
- Detail (doors, windows, balconies, shopfronts, dormers, timber framing) is
  placed by a constraint solver (wave function collapse) on the facades.
- Buildings on the same plot (house, garage, side building) share a palette.
- The same input and seed always produce the same building.

## Fixed decisions

| Topic | Decision |
|---|---|
| Target | three.js, TypeScript library |
| Pieces | Generated in code, no modelled assets |
| Runtime | Live generation per map tile; quality first, performance must stay viable |
| Look | Flat colour per face; optional palette texture later |
| Data source | Caller's choice. Library input is geometry + attributes. OSM adapter ships as the reference |
| Style | Region (`de`, `us`) and modernity (0..1) are per generation |
| Determinism | Hash-derived; same seed + same input = same output |
| Apps | Area viewer (debug) and single-building studio |

## Building types in scope

house, apartments, townhouse (optional ground-floor store), garage, shed, office,
skyscraper, industrial (factory / storage hall), station (bus / train), store,
canopy (open-sided roof: carport, shelter, fuel station).

## Non-goals (for now)

- Special buildings (churches, landmark architecture). They get plain massing
  with the given roof.
- Interiors, textures, signage text.
- Fetching or interpreting map data inside the core.
- LoD2 / CityGML import. A caller can feed such data through the same input.

## Reference look

Low-poly, flat shaded, saturated but limited palettes; windows as inset glass
with frames; visible trim bands, parapets, dormers, balconies.
