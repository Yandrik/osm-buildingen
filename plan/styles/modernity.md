# Modernity and era

`modernity` is a number from 0 (old) to 1 (new). Internally each building has
an `era` on the same scale. Reference points:

| Era | Roughly | German look | US suburban look |
|---|---|---|---|
| 0.0 | before 1850 | timber frame, steep roof, small windows | colonial / farmhouse, clapboard |
| 0.25 | 1850 – 1930 | plaster or brick, tall windows, trim bands | craftsman, porch, gables |
| 0.5 | 1950 – 1975 | plain plaster, moderate pitch, wide windows | ranch, low pitch, attached garage |
| 0.75 | 1980 – 2005 | dormers, balconies, coloured plaster | two-storey, multi-gable |
| 1.0 | after 2005 | cubic, flat or low mono-pitch, large glass | modern farmhouse or flat-roof modern |

`year` maps onto era piecewise-linearly through these points.

Every style value that depends on time is a curve over era: tile weights,
roof shape weights, pitch, level height, palettes. A curve is a short list of
(era, value) points with linear interpolation, so tuning is editing numbers.

The slider prioritises, it does not force: each building's era is the slider
value plus seeded noise (standard deviation 0.12), clamped to 0..1.
