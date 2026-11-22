# German pack: residential (house, apartments, townhouse, garage, shed)

## Roof

- Shapes by era: old gabled 85 %, half-hipped 10 %, hipped 5 %; mid gabled
  75 %, hipped 15 %, flat 10 %; new flat 45 %, skillion 20 %, gabled 30 %,
  hipped 5 %.
- Pitch 48° (old) falling to 30° (1990s); new pitched roofs 22 – 35°.
- Roof colours: red and red-brown tile dominate, then anthracite, then brown;
  new flat roofs are grey.
- Small overhang (0.2 – 0.4 m).

## Walls and palette

Plaster in whites, creams, light yellows, light greys; some ochre, salmon,
pale green. Old era adds timber frame (dark brown or oxblood beams on white
or cream infill). New era: white, light grey, anthracite accents, wood
cladding accents.

## Facade tiles

| Tile | Eras | Notes |
|---|---|---|
| blank | all | |
| window_framed | old – mid | 2-wing with mullion, shutters optional at old |
| window_plain | mid – new | wider, no frame |
| window_floor | new | floor to ceiling |
| timber_panel, timber_window | old | beams drawn as boxes on the wall; upper floors may jetty out |
| door_main | all | step, canopy at mid and new |
| balcony | 0.5+ | apartments and houses, upper rows |
| shopfront, shop_door | all | townhouse and apartments ground floor |
| door_garage | all | garages; sectional at new, double-wing at old |

Rules: windows stack; timber framing covers a whole building or only the
upper floors, never a single cell; shopfronts run as one continuous band.

## Townhouse

Narrow, 3 – 5 levels, usually blocked on both sides. Store probability on the
ground floor is a caller option (default 0.35; `shop` forces it).

## Garage and shed

Garage: flat roof (80 %), one garage door per 3 m on the street wall, blank
elsewhere, wall colour from the group. Shed: timber or metal colour, skillion
or gabled, one small door, at most one window.
