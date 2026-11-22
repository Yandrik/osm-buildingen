# Pipeline

| # | Stage | Input | Output | Random? |
|---|---|---|---|---|
| 1 | [resolve](01-resolve.md) | BuildingInput | ResolvedSpec | yes |
| 2a | [walls](02-massing-roofs.md) | ResolvedSpec | WallSegment[] | no |
| 3 | [context](03-context.md) | walls, neighbours, roads | WallContext[] | no |
| 2b | [roof](02-massing-roofs.md) | spec, walls, context | RoofGeometry | no |
| 4 | [facade](04-facade-wfc.md) | Massing, context, style | FacadeLayout | yes |
| 5 | [roof details](05-roof-details.md) | Massing, style | RoofDetail[] | yes |
| 6 | [mesh](06-mesh.md) | everything above | BuildingMesh | no |

Rules for every stage:

- Pure function. No globals, no clocks, no `Math.random`.
- Random stages take their own sub-seed (see ../03-determinism.md).
- A stage must not throw for valid input. If it cannot do the nice thing, it
  does the plain thing (flat roof, blank wall) and records a note in `debug`.
- `detail: 'massing'` runs stages 1, 2 and 6 only.

Context runs between walls and roof because the roof needs to know which walls
are blocked: there is no overhang towards a close neighbour.
