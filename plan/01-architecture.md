# Architecture

## Repo layout

```
packages/
  core/     generator: input -> mesh buffers. No three.js, no OSM, no DOM.
  three/    buffers -> BufferGeometry, per-tile merging, material.
  osm/      OSM data -> BuildingInput[] (tags, neighbours, roads, groups, seeds).
apps/
  studio/   single-building editor.
  viewer/   OSM area debugger.
plan/       this design.
```

pnpm workspace, strict TypeScript, vitest, vite for the apps, biome for
formatting and linting.

## Dependency rules

- `core` has two runtime dependencies: `earcut` (triangulation) and
  `polyclip-ts` (polygon boolean operations, used only in `geom/boolean.ts`).
  The clipper was added because building parts share edges and vertices with
  their outline, which is where simple clippers fail; writing a robust one is
  a project of its own.
- `three` depends on `core` types and on `three` (peer dependency).
- `osm` depends on `core` types only.
- Apps may depend on everything.
- Nothing in `packages/` touches the DOM or the network, except the Overpass
  helper in `osm`, which is a separate entry point.

Change from the first plan: style packs live in `core/src/styles`, not in their
own package. A pack is only meaningful together with the piece builders it
names, so splitting them created a dependency in both directions. Custom packs
can still be passed in by the caller.

## Core layout

```
core/src/
  index.ts            public API (generateBuilding, types, registerStylePack)
  types.ts            input and output types
  rng.ts              hashing and seeded random
  geom/               vec2, polygon ops, oriented box, skeleton, triangulation
  pipeline/
    resolve.ts        input -> ResolvedSpec
    massing.ts        spec -> walls + roof faces
    roofs/            one file per roof family
    context.ts        neighbours, roads -> per-wall constraints
    facade/           grid, solver, constraints
    roofDetails.ts
  pieces/             code-generated parts (window, door, balcony, dormer, ...)
  styles/             StylePack type, palettes, built-in packs
  mesh/builder.ts     growable typed-array mesh builder
```

## Data flow

```
BuildingInput
  -> resolve      ResolvedSpec   type, levels, heights, roof, era, palette
  -> massing      Massing        wall segments, roof faces, gable areas
  -> context      WallContext[]  blocked spans, street score, passages
  -> facade       FacadeLayout   cell grid with one tile per cell
  -> roofDetails  RoofDetail[]
  -> mesh         BuildingMesh   positions, normals, colours, indices
```

Each stage is a pure function of the previous results and its own sub-seed.
Every intermediate result can be returned in `debug` for the studio.

## Stability promises

- The public API is `packages/core/src/index.ts`. Everything else is internal.
- Output changes only when `GENERATOR_VERSION` is bumped (see determinism).
- Style packs are validated when registered; an invalid pack throws early.
