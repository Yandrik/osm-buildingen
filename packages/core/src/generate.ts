import { assemble } from './pipeline/assemble';
import { buildContext } from './pipeline/context';
import { layoutFacade } from './pipeline/facade/layout';
import { resolve } from './pipeline/resolve';
import { buildRoof } from './pipeline/roofs';
import { applyRoofToWalls, buildWalls } from './pipeline/walls';
import type { BuildingInput, BuildingMesh, ResolvedSpec, WallContext } from './types';

// `performance` exists in browsers, workers and Node, but core is compiled without DOM types.
const clock = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (clock ? clock.now() : 0);

/** Cheap: what the generator would decide for this input, without building geometry. */
export function resolveBuilding(input: BuildingInput): ResolvedSpec {
  return resolve(input);
}

/**
 * Generates one building. Pure: the same input always gives the same mesh.
 * Throws BuildingInputError for unusable footprints; otherwise always returns a mesh.
 */
export function generateBuilding(input: BuildingInput): BuildingMesh {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string): void => {
    const n = now();
    timings[name] = n - t;
    t = n;
  };

  const spec = resolve(input);
  lap('resolve');
  const walls = buildWalls(spec);
  const context = buildContext(input, spec, walls);
  lap('context');

  // No overhang where a neighbour stands close; the roof would poke into it.
  const outerCount = spec.footprint.outer.length;
  const overhang = walls
    .slice(0, outerCount)
    .map((_, i) => ((context[i] as WallContext).openFraction > 0.5 ? spec.roof.overhang : 0));
  const roof = buildRoof({ spec, walls, overhang, eave: spec.base + spec.wallHeight });
  applyRoofToWalls(walls, roof);
  lap('roof');

  const full = (input.detail ?? 'full') === 'full';
  const facade = full ? layoutFacade(input, spec, walls, context) : null;
  lap('facade');

  const mesh = assemble(spec, walls, roof, facade, input.baseElevation ?? 0, input.seed);
  lap('mesh');

  if (input.debug) mesh.debug = { spec, walls, context, facade, roofFaces: roof.faces.length, timings };
  return mesh;
}
