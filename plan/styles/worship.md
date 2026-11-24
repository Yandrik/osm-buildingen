# Worship

Churches, chapels, cathedrals, mosques, synagogues and temples share one type,
`worship`. Until it existed they were "special" and built as massing only.

## Mapped parts come first

Most churches in OSM carry careful 3D mapping: towers, spires, pinnacles,
aisles and apses as `building:part`s. That geometry is never replaced. Each
part only gets a role, `ResolvedSpec.volume`, judged from its resolved shape
(`pipeline/volumes.ts`), and is decorated according to it:

| Volume | Rule | Facade |
|---|---|---|
| `small` | area < 4 m², narrower than 1.5 m, or walls under 2.5 m (a spire mapped as its own part); oblong and under 2.5 m wide (a buttress); walls more than 6 × the longer side (a pier, a corner turret); a skillion at least twice as high as the plan is long (the weathering of a buttress) | blank wall only |
| `tower` | footprint at most 2.2 : 1 and wall top at least 1.4 × its longer side above the ground | windows in the shaft, clock, belfry in the top row |
| `main` | everything else: nave, aisles, apse, chancel, transept, porch | one big window per bay, portal |

Tiles name the volumes they may appear on (`FacadeTile.volumes`); tiles
without the field fit every volume. Other types always resolve to `main`.

What a part gets besides its tiles:

- **Roof shape.** A tower part without a mapped `roof:shape` gets a pyramid.
- **Roof colour** where none is mapped on the part (`partRoofColour`): small
  parts are stone like their walls; otherwise the building's own mapped roof
  colour (parts do not inherit it by themselves, and the Münster's spire is
  stone because its outline says so); towers with a pointed roof get the
  building's spire colour from `PaletteSet.spire` (slate, copper, lead), one
  per building. A mapped pure black is softened to anthracite: between stone
  walls a black lean-to reads as a hole.
- **Wall colour.** Small parts are a shade darker than the walls, so
  buttresses and pinnacles stand out against them in flat light.
- **Blocking.** A part hides the walls beside it up to its wall top plus its
  roof, unless the roof tapers to a point (`blockingTop`): an aisle's lean-to
  covers the nave wall behind it, so the clerestory windows start above it.

Where the parts leave the outline uncovered, the rest is built as the body
(generate.ts). For places of worship a part mapped above the ground (from
2.5 m) is never taken for a bridge over open space: the body under it is kept
and ends flat where that part begins (`lidOver`). The west porch of the
Münster is mapped only as its lean-to roof from 14 m up; the porch under it
used to get walls and a roof of its own that poked through that roof.

## Rows by volume

The level count is ignored: churches are tagged with 1 level, or the storeys
of the tower. Rows follow the volume (`TypeStyle.rows`, `setVolume`):

- main body: one row per 16 m of wall, so up to 24 m it is a single tall row
  (one window per bay from floor to eaves) and a basilica's nave has two or
  three;
- tower: stages about as high as the tower is wide (1.1 ×, between 3 and
  9 m), rounded down generously;
- small: one row.

Without a mapped height the walls are 0.8 × the width of the body (4.5 to
14 m).

## Architecture as facade variant

The variant is the architecture. The OSM adapter maps `building:architecture`
(gothic, neo-gothic, brick_gothic → `gothic`; romanesque → `romanesque`;
baroque, renaissance, classicism, historicism → `classic`; modern, brutalist →
`modern`), otherwise it is rolled from the era. All parts share it.

- `romanesque`: round-arched windows with a stone surround, high in the wall;
  round portal with three orders and an oculus.
- `gothic`: tall pointed windows with a mullion that forks into the arch
  (Y-tracery), stepped buttresses with weatherings at the bay edges; pointed
  portal with three orders and a rose window.
- `classic`: tall round-arched windows with a frame, keystone and sill; portal
  between pilasters with an oculus.
- `modern` (era from about 0.45): narrow slits from floor to eaves; glazed
  doors under a round window.

Window piece additions: `pointed`, `buttress` (with `edgeL` / `edgeR`),
`segments`, `slim`, `tracery`, `twin`. New pieces (`pieces/portal.ts`):
`portal` (stepped reveals, double door, tympanum, round window above when the
cell is tall enough; a rose with spokes, an oculus with a cross, or a Star of
David on a synagogue) and `clock`.

Towers: slits in bays up to 3 m (`FacadeTile.maxWidth`), lancets in wider
ones, and louvred belfry openings in the variant's arch form, two or three
side by side in a wide bay (`twin`). The belfry's vertical socket `bel`
accepts nothing above it, so it only appears in the top row. One tower per
building, the one with the largest footprint, carries clock faces in the row
below the top one (`TypeStyle.towerClock`, role `clock`, placed by the layout,
at least 6 m up). Towers get an odd number of bays so a wall has a middle one.

Openings are narrow and centred, so `openingProbe: 0.34`: a neighbour only
blocks a cell when it covers the middle third of it.

## Buttresses

Mapped buttresses come in two forms, and both are left as they are:

- **As parts** standing against a wall (the Münster). `TypeStyle.pierBays`:
  where a slim part of the same building touches a wall (up to 3.2 m wide,
  from the ground to at least 40 % of the wall), the bays are laid out between
  such piers instead of evenly along the wall; each pier is a blank column of
  its own. Both aisles of the Münster get a window in every bay this way.
- **In the outline** (Sankt Georg, Valentinskapelle): bumps about a metre
  deep. Bays under 2 m (their faces) stay plain. The roof is built on the
  outline without the bumps (`roofs/eaves.ts`, `TypeStyle.straightEaves`), so
  its eave runs straight; each buttress ends at the eave with a flat stone
  top, and a piece of gable wall is added above a buttress that stands against
  a gable end.

Generated buttresses (gothic) are only drawn on free cell edges: between two
open bays, or at an outside corner with nothing standing against it. The
layout says which (`FacadeCell.params.edgeL` / `edgeR`).

## The west front

Churches have their portal at the west end whatever the streets do
(`frontOf`: west, or south for a church lying north-south). The entrance goes
to the part reaching furthest that way that stands on the ground and has a
wall towards the front at least 2.6 m wide (`frontPart`: a tower before
anything else, a round porch never), and on that part to the wall facing the
front (`FacadeHints.front`). That wall gets an odd number of bays. Other
faiths follow the street like every other type.

## Roofs

- `TypeStyle.hippedEnds`: a gabled roof on an outline that is no plain
  rectangle needs only one gable end; every other end is hipped, as over an
  apse. Without any gable end the roof is hipped all round. This replaces the
  single ridge on the box axis, which left walls of a narrower part standing
  above the roof.
- Swept roofs take a profile (`RoofInput.profile`, see
  pipeline/02-massing-roofs.md): bell roofs with a lantern, orthodox bulbs.
- Details (`roofDetails`): a finial on the tip of every tower roof that comes
  to a point: a ball and a cross, a three-barred cross for orthodox churches,
  two balls for mosques, a ball alone otherwise; and a round window high in
  each gable (`gableOculus`). Neither is built at massing detail.

## Faith

`BuildingInput.faith` (`christian`, `orthodox`, `muslim`, `jewish`, `other`;
default christian). The OSM adapter reads it from `religion`, `denomination`
(anything orthodox) and, failing those, the `building` value. It picks the
finial, the steeple of a church without parts (orthodox: a gilded onion), the
west front rule (churches only) and the round window of a portal (Star of
David).

## Churches without parts

`worshipParts` gives a church without parts a steeple of its own, as parts, so
the far massing view has it too. What it looks like is style data
(`TypeStyle.steeples`, `SteepleStyle`): a shaft, optional stages on it (square
or octagonal), a roof on top (any shape, with a profile and colour if wanted)
and pinnacles on the shaft's corners. One design is rolled among those that
fit the architecture and the faith; faiths without a design get none.

- under 300 m² (rectangularity ≥ 0.6, a ridge along its length): a ridge
  turret (Dachreiter) rising out of the roof near the west end. Gothic: a
  needle spire; romanesque: a pyramid; classic: an octagon under a bell roof;
  orthodox: an octagonal drum under a gilded onion. On a roof whose front end
  may be hipped it stands one roof width in, where the ridge is.
- from 300 m² (rectangularity ≥ 0.75): a square west tower, half as wide as
  the nave, inside the outline and 30 cm proud of the west wall (flush,
  rounding left a sliver of nave in front of it). Gothic: an octagonal belfry
  between four pinnacles under a tall spire, or the spire straight on the
  shaft; romanesque: a low pyramid, with or without an octagonal stage;
  classic: an octagonal belfry under a bell roof with lantern and small onion,
  or a narrower square stage under a low pyramid; modern: a plain campanile;
  orthodox: drum and onion.

A church mapped as a plain rectangle may also get a polygonal east end
(`steeples.apse`): the two corners away from the front are cut off, inside the
outline, and the roof is hipped over them. Around a west tower the whole roof
is then hipped, which also spares the stubs beside the tower their gables.

The building's height and roof are pinned to what the parts were fitted to,
since the body is rebuilt as a part with a seed of its own.

## Next

- Tower forms for mapped towers that have no roof part: helm roofs, gablets.
- Rhenish helms and broach spires as roof shapes of their own.
- Orthodox and synagogue facades (round arches, a drum over the crossing; a
  grid of small windows), mosques (dome, minaret), castles (battlements).
- Verge trim on gable rakes; a cornice that follows straightened eaves.
- Walls that are split by a slight bend are laid out and gabled separately
  (the front of the Russian Orthodox church in Ulm): treat nearly straight
  runs as one wall.
