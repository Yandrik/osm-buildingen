# Stage 6: mesh

## Mesh builder

`MeshBuilder` appends to growable typed arrays:

```ts
quad(a, b, c, d, colour)        // flat shaded, normal from the corners
tri(a, b, c, colour)
polygon(points3d, colour)       // triangulated with earcut in the face plane
box(frame, size, colour)        // helper for frames, sills, chimneys
finish(): BuildingMesh
```

Every face owns its vertices (flat shading), with one normal and one colour
per face repeated on its vertices.

## Pieces

A piece draws one facade cell or one roof detail. Signature:

```ts
type Piece = (frame: CellFrame, params, palette: Palette, mb: MeshBuilder) => void;
interface CellFrame {
  origin: Vec3;      // bottom-left corner of the cell on the wall plane
  right: Vec3; up: Vec3; normal: Vec3;   // unit vectors
  width: number; height: number;
}
```

A piece is responsible for the whole cell, including the wall around its
opening. Windows are real insets: wall border, reveal, glass, optional frame
and sill. Everything scales to the cell size; proportions come from `params`.

Pieces planned: wall, window (plain, framed, mullioned, tall, band), door
(main with optional canopy and step), garage door, shopfront, balcony (slab,
railing, door behind), arch, timber frame overlay, loading dock, curtain wall
panel, dormers, chimney, parapet, AC unit, skylight, solar panel.

## Assembly

1. Walls: per facade cell, call its piece. Wall area outside the grid
   (gables, sloped tops) is filled with plain polygons.
2. Trim: plinth band, level bands, corner boards, eaves, by style.
3. Roof faces, then roof details.
4. Floor is not generated.

## Massing-only detail level

Walls as single quads, roof faces, no pieces. Same colours, so a far tile
looks like a simplified version of the near one.

## Palette texture (later)

Optional output mode: instead of vertex colours, write a palette index as UV
into a small texture. Not needed for the first version.
