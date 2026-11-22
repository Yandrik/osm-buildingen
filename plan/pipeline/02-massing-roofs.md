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
| gabled | ridge on the long axis of the oriented box; footprint split at the ridge; height falls off linearly with distance to the ridge | yes, exact for rectangles |
| pyramidal | fan to an apex above the centroid | convex-ish |
| hipped | straight skeleton | yes |
| half-hipped | gabled with the gable tips clipped by small hips | rectangles first |
| gambrel, mansard | two-pitch variants of gabled / hipped | rectangles first |

Roof overhang (eaves sticking out 0.2–0.6 m) is a style parameter; it offsets
the roof outline outward, except along blocked walls.

## Straight skeleton

Needed for hipped roofs on non-rectangular footprints and for clean gabled
roofs on L, T and U shapes.

- Own implementation in `geom/skeleton.ts` (wavefront with edge and split
  events). Footprints are small, so O(n²) is fine.
- Output: one roof face per footprint edge, as a 2D polygon plus a height
  function (distance from the edge times the slope).
- Gabled from skeleton: for edges marked as gable ends, the skeleton node is
  pulled onto the edge midpoint so that face becomes vertical.
- Checks after every run: faces cover the footprint, no overlaps, every face
  touches its edge. On failure fall back: hipped -> gabled (oriented box) ->
  flat. The fallback is recorded in `debug`.

## Multi-part buildings

Each part gets its own massing. Walls shared between parts are detected (edge
overlap within 5 cm) and only the portion above the lower part is kept.

## Courtyards

Hole rings produce inward-facing walls. Flat roofs handle holes directly;
pitched roofs need the skeleton with holes, otherwise fall back to flat.
