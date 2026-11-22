import { polygonArea, ringBounds } from './geom/polygon';
import { mergeMeshes } from './mesh/merge';
import { assemble } from './pipeline/assemble';
import { buildContext } from './pipeline/context';
import { layoutFacade } from './pipeline/facade/layout';
import { resolve } from './pipeline/resolve';
import { buildRoof } from './pipeline/roofs';
import { applyRoofToWalls, buildWalls } from './pipeline/walls';
import type {
  BuildingDebug,
  BuildingInput,
  BuildingMesh,
  NeighbourInput,
  PartInput,
  ResolvedSpec,
  WallContext,
} from './types';

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
 *
 * A building with `parts` is built from its parts only (the outline is not drawn),
 * all sharing type, era and palette.
 */
export function generateBuilding(input: BuildingInput): BuildingMesh {
  if (input.parts && input.parts.length > 0) return generateParts(input, input.parts);
  return generateOne(input);
}

function generateOne(input: BuildingInput): BuildingMesh {
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

  const mesh = assemble(spec, walls, roof, context, facade, input.baseElevation ?? 0, input.seed);
  lap('mesh');

  if (input.debug) mesh.debug = { spec, walls, context, facade, roofFaces: roof.faces.length, timings };
  return mesh;
}

/** Turns one part into a stand-alone input that inherits from the building. */
function partInput(
  input: BuildingInput,
  parent: ResolvedSpec,
  part: PartInput,
  index: number,
): BuildingInput {
  // Upper-level height of the building, so `minLevel` and level counts line up between parts.
  const nominal = parent.levelHeights[parent.levelHeights.length - 1] ?? 3;
  const minLevel = Math.max(0, part.minLevel ?? 0);
  const minHeight = part.minHeight ?? minLevel * nominal;
  const levels = part.levels !== undefined ? Math.max(1, part.levels - minLevel) : undefined;
  const hasOwnSize = part.height !== undefined || levels !== undefined;
  return {
    footprint: part.footprint,
    type: parent.type,
    height: part.height ?? (hasOwnSize ? undefined : input.height),
    levels: levels ?? (hasOwnSize ? undefined : input.levels),
    minHeight,
    roof: part.roof ?? (hasOwnSize ? undefined : input.roof),
    colours: { ...input.colours, ...part.colours },
    year: input.year,
    hasAddress: input.hasAddress,
    shop: input.shop,
    shopProbability: input.shopProbability,
    roads: input.roads,
    // One palette, era and facade variant for all parts.
    groupKey: input.groupKey ?? `self:${input.seed}`,
    style: input.style,
    seed: `${input.seed}/part${index}`,
    baseElevation: input.baseElevation,
    detail: input.detail,
    debug: input.debug,
  };
}

function generateParts(input: BuildingInput, parts: readonly PartInput[]): BuildingMesh {
  const parent = resolve({ ...input, parts: undefined });
  const inputs = parts.map((part, i) => partInput(input, parent, part, i));

  // First pass: resolve every part to learn its wall top, so parts can block each other correctly.
  const specs: (ResolvedSpec | null)[] = inputs.map((p) => {
    try {
      return resolve(p);
    } catch {
      return null; // a degenerate part is left out, the rest of the building still builds
    }
  });
  const bounds = specs.map((s) => (s ? ringBounds(s.footprint.outer) : null));

  // The entrance goes to the largest part that stands on the ground.
  let entrance = -1;
  let entranceArea = 0;
  specs.forEach((s, i) => {
    if (!s || s.base >= 0.5) return;
    const area = polygonArea(s.footprint);
    if (area > entranceArea) {
      entranceArea = area;
      entrance = i;
    }
  });

  const meshes: BuildingMesh[] = [];
  const debugs: BuildingDebug[] = [];
  let entranceDebug: BuildingDebug | undefined;
  inputs.forEach((partIn, i) => {
    const spec = specs[i];
    const box = bounds[i];
    if (!spec || !box) return;
    const others: NeighbourInput[] = [];
    specs.forEach((other, j) => {
      const ob = bounds[j];
      if (j === i || !other || !ob) return;
      if (
        ob.minX > box.maxX + 2 ||
        ob.maxX < box.minX - 2 ||
        ob.minY > box.maxY + 2 ||
        ob.maxY < box.minY - 2
      )
        return;
      others.push({
        footprint: { outer: other.footprint.outer },
        height: other.base + other.wallHeight,
        minHeight: other.base,
        sameGroup: true,
      });
    });
    const mesh = generateOne({
      ...partIn,
      neighbours: [...(input.neighbours ?? []), ...others],
      entrance: i === entrance && input.entrance !== false,
    });
    meshes.push(mesh);
    if (mesh.debug) {
      debugs.push(mesh.debug);
      if (i === entrance) entranceDebug = mesh.debug;
    }
  });

  const merged = mergeMeshes(meshes);
  if (input.debug) {
    const main = entranceDebug ?? debugs[0];
    if (main) merged.debug = { ...main, parts: debugs };
  }
  return merged;
}
