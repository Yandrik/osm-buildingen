# Stage 1: resolve

Turns the sparse input into a complete `ResolvedSpec`. Everything later reads
only the spec, never the raw input.

## Measurements taken first

Area, perimeter, oriented bounding box (long side, short side, angle),
rectangularity (area / box area), vertex count, hole count.

## Type

Given `type` wins. Otherwise:

| Condition | Type |
|---|---|
| area < 12 m² | shed |
| area < 45 m² and no address | garage |
| area > 1500 m² and rectangularity > 0.8 | industrial |
| area > 400 m² | apartments |
| otherwise | house |

Office, skyscraper, station, store and townhouse are never guessed; the caller
(for OSM: the adapter, from tags) must ask for them. One exception: an office
with a resolved height above 60 m is treated as skyscraper.

## Era

`modernity` (0 old .. 1 new) is the centre of a distribution, not a fixed
value: `era = clamp(modernity + noise * 0.12)`, so a street has some spread.
`year`, when given, maps directly onto the same 0..1 scale (see
../styles/modernity.md) and skips the roll. Buildings sharing a `groupKey`
share the era.

## Levels and heights

Level height by type and era (2.6 – 4.5 m; old townhouses taller, garages 2.5).

| Given | Result |
|---|---|
| height and levels | level height = (height − roof height) / levels |
| height only | levels = round((height − roof height) / level height), min 1 |
| levels only | wall height = levels × level height |
| neither | levels drawn from a per-type table weighted by area and era |

Default level tables (weights): house 1:2, 2:6, 3:1; apartments 3–6;
townhouse 3–5; office 3–8; skyscraper 18–45; industrial 1 (6–10 m);
garage, shed 1; station 1–2; store 1–2.

## Roof

Shape: given shape wins. Otherwise a weighted pick from the style pack for
(type, era), restricted to shapes the footprint supports:

- gabled, half-hipped, gambrel need rectangularity > 0.6 or a working skeleton;
- pyramidal needs an aspect ratio below 1.4;
- with holes, pitched shapes become hipped (skeleton with holes); flat and
  skillion become flat.

Garages default to flat (weight 0.8), sheds to skillion or gabled.

Roof height: given, else `roof.levels × 3 m × 0.9`, else from the pitch in the
style pack (for example 38–50° for old German houses, 15–30° for US suburban)
times half the short side, capped at 9 m. For footprints that are not
near-rectangles the "short side" is the widest wing: twice the highest point of
the straight skeleton (see 02-massing-roofs.md).

Ridge direction: along the long side unless `roof.ridge = 'across'` or
`roof.direction` is given.

## Palette

Wall, roof, trim, door, glass, accent. Drawn from the style pack's weighted
lists for the era, with the sub-seed taken from `groupKey` when present so the
whole plot matches. Explicit `colours` override single entries. Garages and
sheds reuse the group's wall colour but may darken it slightly.

## Parts

With `parts`, each part is resolved like a building, sharing type, era, palette
and level height with the parent. Parts whose heights differ by less than half
a level are snapped to a common level grid so window rows line up.
