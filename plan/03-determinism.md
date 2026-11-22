# Determinism

## Seed derivation

```
root      = hash(GENERATOR_VERSION, input.seed)
groupSeed = hash(GENERATOR_VERSION, input.groupKey ?? input.seed)
stageSeed = hash(root, stageName)          // 'resolve', 'facade', 'roofDetails', ...
```

- Era, palette and other plot-wide choices use `groupSeed`.
- Each stage, and each independent decision inside a stage, uses its own
  named sub-seed. Adding a decision later does not shift existing ones.

## Random generator

`rng.ts`: 32-bit integer hash (string and number inputs) and a small seeded
generator (sfc32). `Math.random` is banned in `core` (lint rule).

## Numeric safety

- Decisions (which tile, how many levels) are made from integers or from
  values quantised to 1 mm, so floating-point differences between engines
  cannot flip a choice.
- Trigonometry is only used to place geometry, never to decide.
- Iteration order is always array order; no reliance on object key order.

## Versioning

`GENERATOR_VERSION` is mixed into every seed. Any change that alters output
for an existing input must bump it. Golden tests fail when output changes
without a bump.

## Seed from OSM

The adapter derives `seed` from a hash of the quantised footprint and the
relevant tags, not from the OSM id, so re-imports and id changes keep the
look. `groupKey` comes from address or plot grouping.
