# Stage 2: massing and roofs

Produces walls and roof faces. No detail yet.

## Output

```ts
interface Massing {
  walls: WallSegment[];     // one per footprint edge (outer ring and holes)
  roofFaces: RoofFace[];    // planar 3D polygons with a kind
  gables: GableArea[];      // wall areas above the eave, for attic windows
  eaveHeight: number;
  topHeight: number;
}
interface WallSegment {
  a: Vec2; b: Vec2;         // footprint edge, outside on the right of a->b
  base: number;             // min height
  topA: number; topB: number; // wall top at each end (differs under skillion)
  ring: number; index: number;
}
```

## Roof shapes

| Shape | Method | Arbitrary footprint? |
|---|---|---|
| flat | cap polygon, optional parapet | yes, with holes |
| skillion | one tilted plane along `direction` | yes |
| gabled | rectangle (or `ridge = across`): ridge on the axis of the oriented box, exact. Otherwise: skeleton with the wing ends held still, one ridge per wing | yes; single ridge on the box axis if fewer than two wing ends are found |
| pyramidal | fan to an apex above the centroid | convex-ish |
| hipped | straight skeleton | yes, with holes |
| half-hipped | skeleton; gable edges start to move at 60 % of the gable height, which hips the tip | yes; falls back to gabled without gable ends |
| gambrel | gabled from the skeleton with a kinked height profile | as half-hipped |
| mansard | hipped with a kinked height profile, no overhang | yes |

All skeleton roofs come from one builder, `roofs/fromSkeleton.ts`. It works in
"time" (the inward distance from the wall, which is what the skeleton returns) and
turns time into height at the very end through a profile: a straight line for
hipped and gabled, two segments for mansard and gambrel (faces are cut along the
kink). The slope is scaled so the highest skeleton point is at `roof.height`.

Roof overhang (eaves sticking out 0.2–0.6 m) is a style parameter. Every face is
simply continued outward in its own plane, so the eave drops by overhang × slope.
At a corner the hip or valley line is continued too. Where neighbouring walls have
different overhangs (0 along blocked walls) both faces reach the hip line at the
smaller overhang and the wider one gets a corner of its own. A wall in a notch
narrower than the overhang gets none, and the tip at corners sharper than about
45° is cut off. Overhangs of walls that face each other across a narrow gap may
still overlap; that is not resolved.

With a courtyard every pitched shape becomes hipped (a ring of roof with the ridge
half-way between street and yard); hole edges have no overhang.

Resolve derives the roof height from the pitch times half the span. For rectangles
that span is the oriented box; for everything else that is roofed per wing it is
the highest point of the skeleton (`roofHalfSpan`), otherwise L and U shapes and
courtyard blocks would get roofs two to three times too steep.

## Straight skeleton

`geom/skeleton.ts`, own implementation, no dependencies.

**Algorithm.** Wavefront propagation. The wavefront is a set of rings of moving
vertices, each defined by its two edges, a start point and a velocity. Two events
change it: an *edge event* (a wavefront edge shrinks to nothing, its ends merge)
and a *split event* (a reflex vertex runs into another wavefront edge and splits
the ring, or with holes joins two rings). After every event all upcoming events are
recomputed from the current wavefront: O(n³) in total, 0.05–0.1 ms for typical
footprints, and no event queue that can go stale. Every vertex leaves an arc
behind; the arcs next to an edge, chained from one end of the edge to the other,
are its face.

**Degenerate input** is the normal case for buildings (parallel walls, equal wing
widths: on a plus shape everything happens in one instant), so:

- Simultaneous events are processed one at a time. Each step leaves a valid
  wavefront that may contain zero-length edges; those collapse in the next steps.
- Two antiparallel edges that become neighbours enclose a strip of zero width. The
  vertex between them has no finite speed; it is resolved at once by walking along
  the shorter edge, which leaves the ridge.
- A reflex vertex that hits exactly the end of an edge hits a vertex. The ring is
  pinched there directly instead of leaving a sliver whose fate depends on noise.
- New vertices are put exactly onto their two wavefront lines, so tolerance errors
  do not add up from event to event (a vertex between nearly parallel edges moves
  at 10⁵ m per unit time and multiplies any such error).
- Collinear walls work (the vertex between them moves straight inward). Points
  closer than 0.01 mm are merged; the edge between them gets an empty face.

**Waiting edges.** An edge can be given a `delay`: it stands still until then, so
its face is vertical, a wall. Infinity gives a gable end (the face is the edge and
the peak on it), a finite delay a half-hip. A waiting edge next to a parallel edge
is not supported (it would need a new wavefront edge); the gable-end picking avoids
that.

**Output.** One face per input edge (outer ring, then holes): a counter-clockwise
polygon starting with the edge, plus the time at every point. Nodes are shared by
index between faces.

**Checks.** Before returning, every face must be closed, counter-clockwise, simple
and planar (time equals the distance from its edge), nodes must lie inside the
polygon and the areas must add up. Because every arc is shared by exactly two
faces, simple counter-clockwise faces are enough for a tiling. If a check fails
the run is repeated with a larger tolerance and then on copies of the input moved
by 0.02 mm and 0.1 mm; if all four attempts fail the function returns null. It
never throws.

**Measured** (seeded random footprints, see `skeleton.test.ts` and `roofs.test.ts`):
no null in 20 000 each of rectilinear unions of 2–3 rectangles (free, on a grid,
rotated), convex polygons, star-shaped polygons, and rectilinear or convex
footprints with a rectangular courtyard. On the same families all five skeleton
roof shapes were valid (planar faces, footprint covered exactly once, wall tops on
the roof) with random overhang patterns, and none fell back to flat. The hard case is walls
that are parallel only up to 10⁻⁵–10⁻⁸ m, where "at the same time" stops being
decidable: there about 5 % need a retry and 0.1–0.3 % return null. OSM corner noise
(millimetres to centimetres) is far from that band.

**Limits.**

- Simple polygons only. Self-intersections, a ring running back along itself and
  holes touching the outer ring return null.
- Holes are supported and tested with rectangular courtyards; holes of other
  shapes have had less testing.
- Near-degenerate input that is retried on a perturbed copy has node positions
  that are off by up to about 0.1 mm.

## Gable ends

`pickGableEnds`: an edge is a wing end if its (plain) skeleton face is a triangle,
both its corners turn inward by 30–150°, the walls on either side are within 25°
of parallel, and it is at least 1 m long. Of two neighbouring candidates the
shorter one wins, so not every edge can become a gable. For (near-)rectangles and
`ridge = across` the ends are instead the walls across the ridge at the ends of
the oriented box.

The skeleton is then run again with those edges waiting. The wall under a gable
gets its top from `RoofGeometry.heightAt` / `breaks` (peak of a full gable, the two
ends of the level part of a half-hip, plus the kinks of a gambrel profile). Over
the gable wall the roof runs out by the overhang along the ridge line.

## Fallbacks

Recorded in `spec.notes` (visible in `debug`):

- hipped, mansard: skeleton fails -> gabled -> flat. With a courtyard: -> flat.
- gabled on a non-rectangle: skeleton fails or fewer than two wing ends -> single
  ridge on the box axis (the old "one big gable") -> flat.
- half-hipped, gambrel: no gable ends or skeleton fails -> gabled.

With `hippedEnds` (a style option, places of worship) a gabled roof on an
outline with more than four corners needs only one wing end: the others are
hipped, as over an apse, and without any the roof is hipped all round.

## Straight eaves

`roofs/eaves.ts`, for styles with `straightEaves` (places of worship). Mappers
draw buttresses into the outline as bumps about a metre deep (out of the wall,
across at most 3.2 m, back in; also diagonally at a corner). A roof on that
outline gets a tooth over each. So the roof is built on the outline without the
bumps and then fitted to the real one: a flat top on every buttress at the eave
(`RoofFace.material: 'wall'`), the piece of gable wall above a buttress that
stands against a gable end, `breaks` answered for the real walls (stretches of
the straight ones), and buttress walls that end at the eave.

## Multi-part buildings

Each part gets its own massing. Walls shared between parts are detected (edge
overlap within 5 cm) and only the portion above the lower part is kept.

## Courtyards

Hole rings produce inward-facing walls. Flat roofs handle holes directly;
pitched roofs are built as hipped from the skeleton with holes, and fall back to
flat if that fails.

## Curved roofs

| Shape | Method |
|---|---|
| cone, dome, onion | The footprint is shrunk towards a centre while rising, ring by ring, along a fixed profile (`roofs/radial.ts`). Needs a centre that sees every edge from inside: round towers, apses, regular polygons, rectangles, even L shapes. Without one the roof falls back to hipped, with a note. |
| round | Barrel roof: the footprint is cut into strips parallel to the ridge, each strip a flat face on an arc (`roofs/round.ts`). Gable walls follow the same profile. |
| pyramidal | When tagged it is tried on any footprint with such a centre; when rolled only on squarish ones. |

Cone, dome and onion take another outline from `roof.profile`: any list of
(scale, share of the height) pairs, a lathe. Bell roofs with a lantern and
orthodox bulbs are profiles in the style pack. A profile that ends with some
width left gets a lid.

These shapes are never rolled; they only come from the input (or from a
steeple design, see styles/worship.md). Their faces have
kind `curved` and get no dormers or chimneys.

## Gabled roofs with holes

A tagged gable on a footprint with small holes (towers standing inside the
body, under 12 % of the area) keeps one ridge on the box axis and cuts the
holes out with the clipper. Larger holes are courtyards and get a hipped ring.

## Sawtooth roofs

`roofs/sawtooth.ts`. The footprint is cut into strips across the long axis,
one tooth each: a long low slope and a short steep glazed face. Every strip is
a planar face, so the side walls follow the zigzag exactly. Rolled for older
industrial buildings on rectangular-ish footprints and honoured when tagged
(OSM `roof:shape=sawtooth`).
