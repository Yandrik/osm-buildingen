# Stage 3: context

Works out, per wall, what the surroundings allow.

## Output

```ts
interface WallContext {
  blocked: Span[];        // parts of the wall with a neighbour closer than 1.5 m
  shared: Span[];         // parts touching a neighbour (< 0.15 m): party wall
  streetScore: number;    // 0..1, how much this wall faces the nearest road
  passages: Span[];       // where a road passes through (height = clear height)
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

A road segment that crosses a wall produces a passage span on that wall, so a
road through a building gives one on the entry wall and one on the exit wall.
Buildings under 300 m² only get one when the road is flagged `passage`
(a road merely clipping the corner of a small house is usually a mapping
inaccuracy). Width is the road width plus 1 m (at least 2.4 m), clear height
3.8 m for roads and 2.8 m for paths, capped by the ground level height.

The facade stage turns the ground cells under a span into arch cells. The
arch is a dark recess 1.6 m deep, not a real tunnel: the inside of a building
is never visible, so this reads the same from the street. A real cut through
the massing is deferred.

## Cost

Neighbour and road counts are small per building (the caller passes only
nearby ones), so this is a direct loop. The OSM adapter does the spatial
indexing.
