# Input and output

## Coordinates

- Input is 2D, in metres, in a local frame: x = east, y = north.
- Output is three.js style, Y up: X = east, Y = up, Z = south (so `z = -north`).
- Rings are open (first point not repeated). Any winding is accepted and
  normalised: outer counter-clockwise, holes clockwise.
- The caller chooses the origin (for example the map tile centre) and applies
  terrain height through `baseElevation`.

## Input

```ts
interface BuildingInput {
  footprint: Polygon;                 // { outer: Vec2[], holes?: Vec2[][] }
  parts?: PartInput[];                // sub-volumes with their own height / roof
  type?: BuildingType;
  height?: number;                    // metres, total including roof
  levels?: number;                    // above-ground levels, excluding roof levels
  minHeight?: number;
  roof?: RoofInput;                   // shape, height, levels, direction, ridge, colour
  colours?: { wall?, roof?, trim?, door? };
  year?: number;                      // construction year, overrides the era roll
  hasAddress?: boolean;               // classification hint
  shop?: boolean;                     // force / forbid a ground-floor store
  shopProbability?: number;           // types whose style allows a store, when `shop` is not set
  balconies?: boolean;                // force / forbid balconies where the type has them
  entrance?: boolean;                 // false = no entrance door
  neighbours?: NeighbourInput[];      // { footprint, height?, minHeight?, sameGroup? }
  roads?: RoadInput[];                // { line, width?, kind?, passage?, covered?: 'yes'|'arcade'|'colonnade' }
  groupKey?: string;                  // same key -> same palette and style
  style: { region: 'de' | 'us'; modernity: number; pack?: string };
  seed: string | number;
  baseElevation?: number;
  detail?: 'massing' | 'full';        // default 'full'
  debug?: boolean;                    // include intermediate stage results
}
```

`height` is measured from the ground like OSM `height`; `minHeight` lifts the
wall base.

### Parts

A building with `parts` is built from its parts. Where the parts do not cover
the outline, the uncovered rest is built as the building's body, with the
building's own height, roof and colours. This is how real data works: mappers
add parts for the towers of a church or the tall wing of a school and leave
the main body to the outline. Rules:

- Body = outline minus the parts that start below the body's wall top. A part
  that starts above it (a roof turret) sits on the body and is not cut out.
- Body pieces under 4 m² or thinner than 1.2 m on average are mapping slivers
  and are dropped, so a fully covered outline gives no body.
- If the subtraction fails, the outline is built whole when the parts cover
  less than 60 % of it, otherwise only the parts are built.
- The outline's holes (courtyards) are cut out of the parts: mappers often
  draw a `building:part` straight across the courtyard of a multipolygon, and
  the passages into the courtyard need it open. Overlaps under 1 m² are left
  alone. A part the cut splits becomes several (the first piece keeps the
  part's seed, the others get `part<i>.<k>`); a part wholly inside a
  courtyard is kept as mapped.
- Parts and body get no roof overhang; they are fitted against each other.

Parts share the building's type, era, palette, facade variant and level
height, so window rows line up. A part's `levels` counts from the ground and
`minLevel` levels are skipped below it (OSM semantics). Parts block each
other's walls where they touch, up to the lower part's wall top. One part gets
the entrance: the largest one standing on the ground.

Building types: house, apartments, townhouse, garage, shed, office,
skyscraper, industrial, station, store, canopy (open-sided roof on posts).

Roof shapes: flat, gabled, hipped, half-hipped, pyramidal, skillion, gambrel,
mansard, dome, onion, cone, round, sawtooth. The curved shapes and sawtooth
on non-industrial buildings only come from the input, they are never rolled.

Precedence for dimensions: `height` > `levels` > inferred. If both are given,
level height is derived from them. `roof.height` > `roof.levels` > style default.

## Output

```ts
interface BuildingMesh {
  positions: Float32Array;   // xyz per vertex
  normals: Float32Array;     // xyz per vertex, flat shaded
  colors: Uint8Array;        // rgb per vertex, 0..255
  indices: Uint32Array;
  bounds: { min: Vec3; max: Vec3 };
  debug?: BuildingDebug;     // only when input.debug is set
}
```

All arrays are transferable, so a worker can hand them over without copying.

## Entry points

```ts
generateBuilding(input: BuildingInput): BuildingMesh
resolveBuilding(input: BuildingInput): ResolvedSpec   // cheap, no geometry
registerStylePack(pack: StylePack): void
GENERATOR_VERSION: number
```

## Errors

Invalid geometry (fewer than 3 points, zero area, self-intersection that cannot
be repaired) throws `BuildingInputError`. Anything else must produce a mesh;
internal failures fall back to simpler output (see each pipeline stage).
