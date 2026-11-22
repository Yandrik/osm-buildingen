# Testing

| Kind | What | Where |
|---|---|---|
| Unit | geometry helpers, rng, parsing, each roof shape on fixed footprints | next to the code, `*.test.ts` |
| Golden | fixed inputs -> hash of the mesh buffers; fails on any output change without a `GENERATOR_VERSION` bump | `core/test/golden` |
| Property | thousands of random footprints and inputs: no throw, finite coordinates, valid indices, normals unit length, mesh inside expected bounds | `core/test/property` |
| Roof validity | roof faces cover the footprint without overlap; walls meet the roof | property tests |
| Determinism | same input twice -> identical buffers; different seed -> different | golden suite |
| Adapter | OSM fixture -> expected types, groups, neighbours | `osm/test` |
| Performance | benchmark script, numbers recorded in the plan, not asserted in CI | `core/bench` |

Fixtures: a trimmed OSM extract of a public city centre lives in
`packages/osm/test/fixtures` (ODbL, attribution in the folder).

Bug workflow: reproduce in the studio, copy the permalink, add it as a golden
or property test case, fix, bump the version if output changed.
