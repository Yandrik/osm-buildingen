# Stage 5: roof details

Status: chimneys, shed dormers, attic windows, rooftop units and stair heads
are built (`pipeline/roofDetails.ts`). Skylights, solar panels, gabled
dormers and the skyscraper crown are not yet. Probabilities per type and era
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

A small constraint pass keeps dormers symmetric around the face centre and at
least one bay apart.

## Flat roofs

Parapet (height by style), then scattered boxes: AC units, stair head, roof
hatch, for offices and industrial a row of skylight strips. Skyscrapers get a
crown or a setback top volume.

## Not placed

Nothing is placed on faces smaller than 6 m², on fallback roofs, or above
blocked walls.
