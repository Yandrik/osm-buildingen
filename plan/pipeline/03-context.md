# Stage 3: context

Works out, per wall, what the surroundings allow.

## Output

```ts
interface WallContext {
  blocked: Span[];        // parts of the wall with a neighbour closer than 1.5 m
  shared: Span[];         // parts touching a neighbour (< 0.15 m): party wall
  streetScore: number;    // 0..1, how much this wall faces the nearest road
  passages: PassageSpan[]; // openings of passages in this wall (height = clear height)
  openFraction: number;   // share of the wall that is not blocked
  courtyard: boolean;     // wall belongs to a hole ring
}
```

## Blocked and shared spans

For each wall, neighbours within 1.5 m are projected onto it. A span is
blocked up to the neighbour's height (if known; otherwise for the full wall
height). Blocked spans get no doors, windows, balconies or overhang. Shared
spans additionally get no trim.

Neighbours with `sameGroup` (garage attached to its house) block in the same
way but also hint that a connecting door is plausible; not used yet.

## Street side

For each wall: distance from the wall midpoint to the nearest road, and the
angle between the wall normal and the direction to the road. The score
combines both. The main door goes on the highest-scoring wall that has an
unblocked ground cell. Without roads, the longest unblocked wall wins;
courtyard walls are the last resort.

Road kind matters: `road` counts fully, `path` half, `rail` only for stations
(where it places the platform side).

## Passages

A passage is a road that runs through the building at ground level. It is a
real opening: you can see and drive through it. Code: `pipeline/passages.ts`.

1. **Which roads.** Roads flagged `passage` or `covered`, or any road crossing a
   footprint of 300 m² or more. Rail lines never. A road merely clipping the corner of
   a small house is a mapping inaccuracy and is ignored.
2. **Corridor.** The road line is widened to the passage width (road width
   plus 1 m, at least 2.4 m, at most 8 m for roads and 4.5 m for paths) and
   clipped to the footprint including courtyards.
3. **Is it a passage?** Only if the corridor piece touches the footprint
   boundary in at least two separate stretches: street to street, or street
   to courtyard. Dead ends, corner clips and slivers give nothing.
   Overlapping corridors are merged. A corridor takes at most half the
   footprint (else it is a gate or kiosk in the road), 85 % for a road tagged
   `covered`: the mapper says the house stands over it.
   A corridor that touches the outline in one stretch is cut where neighbours
   (within 0.5 m) stand in front of the walls. A run against a neighbour of
   at most 6 m leads into that house; a longer one merely follows the party
   wall. Two ways out (open runs, or runs into a neighbour) make it a passage
   after all: in from the street, along the party wall, out at the back. Its
   arches are then split at corners (walls turning by more than 30°), so the
   street end does not hang one arch around the corner along the party wall.
4. **Openings.** Each stretch where the corridor meets a wall becomes an
   opening in that wall (`WallContext.passages`). The facade stage turns the
   ground cells there into arch cells, so arch and tunnel line up exactly.
   An oblique crossing gives a wider opening than the corridor.
5. **Tunnel.** Side walls along the corridor, a flat ceiling at the clear
   height, no floor (the caller draws ground and roads). Clear height is
   3.8 m for roads and 2.8 m for paths, limited by the ground level height;
   below 2.2 m the passage is skipped with a note.
6. **Arch.** The opening has a segmental arch with a trim band. Behind the
   facade the ceiling is flat at the arch's apex height; the lunette above
   the arch curve is closed on the inside. Where a neighbour stands against
   the opening (the next part of the same building, the next house in a
   row), the opening is a plain hole up to the ceiling, so the tunnel
   continues without a lip.
7. **Parts.** Each part computes its own corridor from the same roads; on the
   ground level the corridor wins over "blocked by the neighbouring part", so
   a passage through two parts is continuous. Parts starting above the
   ground are not cut.
8. **Massing detail.** The same tunnel with a plain rectangular opening.
9. **Arcades and colonnades.** A road tagged `covered=arcade|colonnade`
   (`RoadInput.covered`) is the same corridor opened to the street: one
   opening is enough, its corridor is at least 3 m wide, building left
   between it and the facade thinner than 2.2 m is opened too, and the clear
   height is the whole ground storey minus the 0.3 m slab. An untagged path
   whose single opening runs, free of neighbours, along one wall for at least
   6 m and 60 % of its length is an arcade too (arches on old buildings,
   era < 0.5, else a colonnade). The facade stage marks the cells
   (`FacadeOpening.arcade`) and the arch piece draws one bay per cell: a
   pier (0.6 m) or column (0.36 m) where two bays meet (half in each cell), a
   whole one where the arcade reaches the end of the wall, a round arch
   (arcade) or a straight beam with a band (colonnade) between. Bays
   narrower than 0.9 m stay closed. Openings against a neighbour stay plain
   holes, so a row of houses shares one walk. The back wall of the walk gets
   shop windows (2.6 m bays). `Passage.arcade` says which.

The passages are listed in `BuildingDebug.passages` (polygon, clear height,
openings).

In the Ulm fixture the adapter flags roads at 44 buildings; 34 of them get a
passage (40 in total, 13 of them arcades or colonnades on 11 buildings, e.g.
the colonnade along the west side of Münsterplatz, tagged
`covered=colonnade`). The rest are footways under canopies or roads that only
touch a corner.

## Cost

Neighbour and road counts are small per building (the caller passes only
nearby ones), so this is a direct loop. The OSM adapter does the spatial
indexing.
