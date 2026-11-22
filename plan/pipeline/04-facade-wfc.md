# Stage 4: facade layout (wave function collapse)

## Grid

Walls are unrolled into strips of cells.

- Columns: each wall is divided into `round(length / bayWidth)` equal bays.
  `bayWidth` comes from the style (2.4 – 3.6 m; wider for stores and modern
  offices). Walls shorter than 1.2 m become one narrow cell that only accepts
  blank tiles.
- Rows: one per level. Row kinds: `ground`, `upper`, `top`.
- Walls are solved in one pass but are not linked across corners yet: each
  wall is its own grid. Building-wide consistency comes from the facade
  variant (see below), not from corner links.
- Gable areas are not part of the grid; they get at most one attic piece each.

## Tiles

A tile is a facade cell type: `blank`, `window`, `window_tall`, `door_main`,
`door_garage`, `shopfront`, `shop_door`, `balcony`, `arch`, `timber_panel`,
`timber_window`, `loading_dock`, `curtain_wall`, and variants.

Each tile declares:

```ts
interface FacadeTile {
  id: string;
  piece: PieceId;                 // which code-generated piece draws it
  params?: Record<string, number>;
  rows: RowKind[];                // where it may appear
  left: Socket; right: Socket;    // horizontal connectors
  up: Socket; down: Socket;       // vertical connectors
  weight: WeightFn;               // (era, type) => number
  needsOpen: boolean;             // false = allowed on blocked cells
}
```

Sockets are small labels. Two cells may be adjacent when their facing sockets
are compatible according to the pack's socket table. This is how the look is
controlled:

- Vertical sockets stack things: `window` above `window`, `door` below
  `window`, `shopfront` only below `upper` rows. That gives aligned columns.
- Horizontal sockets set rhythm: old offices forbid window next to window
  without a pier; modern ones allow continuous bands; timber panels must
  continue to the corner.
- Corner links use a relaxed table (a pack can say corners accept anything).

## Variants

A type style may define building-wide variants (for example window styles
`framed`, `plain`, `modern`, or office facades `punched`, `band`, `curtain`).
One is rolled per plot in resolve; tiles naming another variant are removed
before solving. This keeps one building from mixing window styles.

Tiles with role door, garage, shop, shopdoor or dock are never placed by the
solver; only the rules in step 2 place them.

## Solve order

1. **Hard constraints.** Blocked cells keep only `needsOpen: false` tiles.
   Passage cells are fixed to `arch`. Narrow cells are fixed to `blank`.
2. **Global picks**, which plain adjacency cannot express:
   - the main door: best-scoring free ground cell on the street wall,
     preferring the middle of the wall;
   - garage doors for garages (one per ~3 m of the street wall);
   - store frontage for townhouses and stores (the street wall's ground row);
   - symmetry: if the pack asks for it and the street wall is free, the
     solver mirrors choices around the wall centre.
3. **Collapse.** Standard loop: pick the undecided cell with the fewest
   options (ties broken by cell index), choose a tile by weight with the
   stage's random generator, propagate.
4. **Contradiction.** Restart with attempt number mixed into the seed, at
   most 8 times. After that, the remaining cells become `blank`. Both the
   attempt count and the fallback are recorded in `debug`.

## Implementation notes

- Options per cell are a 32-bit mask, so a building type can use at most 32
  tiles (after variant filtering there are usually under ten). Compatibility tables are precomputed per pack and cached.
- The grid is small (a house has 30 – 80 cells), so the solve is cheap.
- Minimum window count: if a free wall ends up with no window at all and the
  type expects some, the weights for blank are halved and the wall is solved
  again once.

## Multi-part buildings

Parts with a common level grid are solved as one ring where they form a
continuous outline, so rows and rhythm continue across the joint.
