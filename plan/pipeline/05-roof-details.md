# Stage 5: roof details

Status: chimneys, shed dormers, attic windows, rooftop units, stair heads,
skylight strips, factory chimney stacks and station clock turrets are built
(`pipeline/roofDetails.ts`). Skyscraper crowns are parts, not details (see
../styles/non-residential.md). Solar panels and gabled dormers are not built
yet. Probabilities per type and era
live in the style pack (`TypeStyle.roofDetails`).

Placed after the facade so dormers can line up with window columns.

## Pitched roofs

Candidates are slots along each roof face, aligned to the facade bays below.

| Detail | Rule |
|---|---|
| dormer (gabled, shed, flat) | only if roof height > 2.2 m; on faces above unblocked walls; probability and type from style and era |
| skylight | modern eras instead of dormers |
| chimney | 0 – 2 per building near the ridge; mostly older eras |
| solar panels | modern eras, on the face closest to south |
| attic window | one per gable area when wide enough |
| gable oculus | places of worship: a round window high in each gable of the main body |
| finial | places of worship: on the tip of a tower roof that comes to one point; a ball and what the faith asks for (cross, three-barred cross, second ball, nothing) |

A small constraint pass keeps dormers symmetric around the face centre and at
least one bay apart.

## Flat roofs

Parapet (height by style), then scattered boxes: AC units, stair head, roof
hatch, for offices and industrial a row of skylight strips. Skyscrapers get a
crown or a setback top volume.

## Not placed

Nothing is placed on faces smaller than 6 m², on fallback roofs, or above
blocked walls.
