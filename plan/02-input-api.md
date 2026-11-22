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
  neighbours?: NeighbourInput[];      // { footprint, height?, sameGroup? }
  roads?: RoadInput[];                // { line, width?, kind?, passage? }
  groupKey?: string;                  // same key -> same palette and style
  style: { region: 'de' | 'us'; modernity: number; pack?: string };
  seed: string | number;
  baseElevation?: number;
  detail?: 'massing' | 'full';        // default 'full'
  debug?: boolean;                    // include intermediate stage results
}
```

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
