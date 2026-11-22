# osm-buildingen – working notes for contributors (human or agent)

Low-poly procedural building generator for three.js. Read `plan/README.md` first;
`plan/` is the design and must be updated in the same change as the code.

## Layout

- `packages/core` – generator. Pure TypeScript, no DOM, no three.js, no OSM.
  Only runtime dependency: `earcut`.
- `packages/three` – three.js adapter and worker pool.
- `packages/osm` – OSM data -> `BuildingInput[]`.
- `apps/studio`, `apps/viewer` – Vite apps.
- `tools/` – dev tools. `tools/render.ts` renders meshes to PNG without a GPU;
  `pnpm exec tsx tools/sheet.ts <dir>` writes sample sheets. Use these to look at output.

## Commands

- `pnpm test` – vitest, all packages
- `pnpm typecheck` – `tsc -b`
- `pnpm lint` / `pnpm format` – biome

All three must pass before a change is done.

## Rules

- Coordinates: input x = east, y = north (metres). Output X = east, Y = up, Z = south.
  Outer rings counter-clockwise, holes clockwise, rings open.
- Faces are counter-clockwise seen from outside. `MeshBuilder` computes the normal from that.
- No `Math.random`, no clocks, no globals in `core`: output is a pure function of the input.
  Randomness comes from `Rng` with a named sub-seed (`rng.fork('name')`).
- Decisions use integers or quantised values; trigonometry only places geometry.
- A pipeline stage never throws for valid input. It falls back (flat roof, blank wall)
  and pushes a note to `spec.notes`.
- Any change that alters output for an existing input bumps `GENERATOR_VERSION`
  (`packages/core/src/version.ts`). Agents working in parallel: do not bump it yourself,
  say so in your report instead.
- Style packs are data (`packages/core/src/styles`). New looks should be new data
  first, new pieces second, new pipeline code last.
- Public API is `packages/*/src/index.ts`. Keep it small; everything else is internal.
- TypeScript strict with `noUncheckedIndexedAccess`. No `any`. Comments say why, not what.
- No new runtime dependencies in `packages/` without a strong reason noted in the plan.
- Commit messages: imperative summary line, body if needed.
