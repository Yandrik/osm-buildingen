# Non-residential types

Shared between regions; palettes and a few weights differ. The US pack reuses
these definitions for now.

## Office

- Old (era < 0.4): punched windows with wide piers, more blank wall, stone or
  brick colours, cornice and level bands, flat or low hipped roof.
- Mid: horizontal window bands, concrete greys and beiges.
- New: curtain wall panels, large glass share, thin frames.
- Ground floor: taller level, glazed lobby, main entrance with canopy.
- Multi-part outlines of similar height share the level grid.

## Skyscraper

Built as a composition of parts, synthesised by `pipeline/autoParts.ts` when
the type is skyscraper, the input has no parts of its own, the building has at
least 10 levels and the footprint is at least 16 m wide and reasonably
rectangular. Smaller or awkward footprints stay a plain prism.

- **Podium**: the full footprint, a few levels, more glass.
- **Shaft**: the footprint inset, most of the height, strict vertical rhythm;
  a variant with protruding vertical piers for old and mid eras.
- **Crown**, by era and seed (`TowerStyle.crowns`): stepped setbacks, a
  slender tower with a pyramidal roof, a recessed penthouse block, a taller
  glass top storey, a chamfered (sloped) top, or a spire.

The top of the highest part equals the resolved height exactly when `height`
or `levels` is given. Tiers share one level grid.

## Industrial (factory, storage hall)

Large blank panels in metal greys, blues, greens, brick for old halls; a base
band; roller doors and loading docks on the street wall; a window strip under
the eave. Roofs: flat, low gabled, or **sawtooth** (old and mid eras; teeth
about 6.5 m wide across the long axis, glazed steep faces all facing the same
way, north where the footprint allows). Roof details: skylight strips, vent
boxes, and for old factories a tall chimney stack.

## Station

- Old (era < 0.45): brick or plaster, tall windows with arched tops, base
  band, central entrance with canopy, symmetric street facade, sometimes a
  small clock turret.
- New and small stations: mostly glass, a wide flat roof.
- **Platform roof** (`pipeline/platform.ts`): when a `rail` line runs along a
  wall (within 25 m, roughly parallel), that wall gets a roof on posts over
  the platform, kept clear of the track. The entrance goes on the street
  side, not the rail side.

## Store

1 – 2 levels, continuous shopfront on the street wall, sign band, flat roof
with parapet, mostly blank sides.

## Canopy

An open-sided roof on posts (`pipeline/canopy.ts`): carports, bus shelters,
fuel-station roofs, covered walkways. Posts at the corners and every few
metres along the edges, none along walls where a neighbour stands (the canopy
is attached to it there); a thin roof slab with the resolved roof shape; no
walls, doors or windows. The OSM adapter maps `building=roof`, `carport` and
similar to it.

## Shed

See de-residential.md; the US pack tints it differently.

## Trim on older buildings

Houses, townhouses, apartments, offices and stations before about 1930 get a
slim band between levels and a cornice under the eave or parapet
(`pipeline/trim.ts`, controlled by `TypeStyle.trim`), only along walls that
are not blocked by a neighbour.
