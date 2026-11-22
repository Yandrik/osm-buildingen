import { difference } from './geom/boolean';
import { perimeter, polygonArea, ringArea, ringBounds } from './geom/polygon';
import { mergeMeshes } from './mesh/merge';
import { assemble } from './pipeline/assemble';
import { autoParts } from './pipeline/autoParts';
import { buildContext } from './pipeline/context';
import { layoutFacade } from './pipeline/facade/layout';
import { type Corridor, buildingCorridors, findPassages } from './pipeline/passages';
import { platformRoofs } from './pipeline/platform';
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
 * A building with `parts` is built from its parts, all sharing type, era and
 * palette. Where the parts do not cover the outline, the rest of the outline is
 * built too, with the building's own height and roof (see `uncoveredBody`).
 */
export function generateBuilding(input: BuildingInput): BuildingMesh {
  if (input.parts && input.parts.length > 0) return generateParts(input, input.parts);
  // Towers without mapped parts get a podium, shaft and crown of their own.
  const tiers = autoParts(input);
  if (tiers) return generateParts(input, tiers);
  return generateOne(input);
}

/** `corridors`: for a part, the passages found on the whole building; it does not look at the roads itself. */
function generateOne(input: BuildingInput, corridors?: readonly Corridor[]): BuildingMesh {
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
  const passages = findPassages(input, spec, walls, corridors);
  const context = buildContext(input, spec, walls, passages);
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

  // Parts standing on this roof (the upper tiers of a tower): roof details keep clear of them.
  const onRoof = (input.neighbours ?? [])
    .filter((nb) => (nb.minHeight ?? 0) >= spec.base + spec.wallHeight - 0.5)
    .map((nb) => nb.footprint);
  let mesh = assemble(
    spec,
    walls,
    roof,
    context,
    facade,
    input.baseElevation ?? 0,
    input.seed,
    onRoof,
    passages,
  );
  // Platform roofs along the rail side of a station: canopies of their own, merged in.
  const platforms = platformRoofs(input, spec, walls, context);
  if (platforms.length > 0) mesh = mergeMeshes([mesh, ...platforms.map((p) => generateOne(p))]);
  lap('mesh');

  if (input.debug)
    mesh.debug = { spec, walls, context, facade, passages, roofFaces: roof.faces.length, timings };
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
    // No overhang: parts are fitted against each other, an eave would poke into the neighbour.
    roof: { ...(part.roof ?? (hasOwnSize ? undefined : input.roof)), overhang: 0 },
    colours: { ...input.colours, ...part.colours },
    facadeVariant: part.facadeVariant ?? input.facadeVariant,
    year: input.year,
    hasAddress: input.hasAddress,
    shop: input.shop,
    shopProbability: input.shopProbability,
    balconies: input.balconies,
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

/** Remainder pieces thinner than this (2 × area / perimeter, metres) are mapping slivers, not rooms. */
const MIN_BODY_THICKNESS = 1.2;
const MIN_BODY_AREA = 4;

/**
 * The part of the outline that no part covers, as extra parts carrying the
 * building's own attributes.
 *
 * Strictly, an outline with parts is not a volume of its own. In real data it very
 * often is: mappers add parts for the towers of a church or the tall wing of a
 * school and leave the main body to the outline. So the outline minus the parts is
 * built as the body. Fully covered outlines give an empty result.
 *
 * Parts that start above the body's walls (a roof turret) sit on top of it and are
 * not subtracted; parts that start lower (a wing bridging a passage) are.
 */
function uncoveredBody(
  input: BuildingInput,
  parent: ResolvedSpec,
  parts: readonly PartInput[],
  inputs: BuildingInput[],
): PartInput[] {
  const bodyTop = parent.base + parent.wallHeight;
  const covering = parts
    .filter((_, i) => (inputs[i]?.minHeight ?? 0) < bodyTop - 0.5)
    .map((p) => p.footprint);
  const outline = { outer: parent.footprint.outer, holes: parent.footprint.holes };
  let pieces = difference(outline, covering);
  if (pieces === null) {
    // Clipping failed. Keep the body whole when the parts clearly do not replace it.
    const covered = covering.reduce((sum, p) => sum + ringArea(p.outer), 0);
    parent.notes.push('could not subtract the parts from the outline');
    pieces = covered < 0.6 * parent.metrics.area ? [outline] : [];
  }
  return pieces
    .filter((p) => {
      const area = polygonArea(p);
      return area >= MIN_BODY_AREA && (2 * area) / perimeter(p.outer) >= MIN_BODY_THICKNESS;
    })
    .map((footprint) => ({
      footprint,
      height: input.height,
      minHeight: input.minHeight,
      levels: input.levels,
      roof: input.roof,
    }));
}

function generateParts(input: BuildingInput, given: readonly PartInput[]): BuildingMesh {
  const parent = resolve({ ...input, parts: undefined });
  const givenInputs = given.map((part, i) => partInput(input, parent, part, i));
  const body = uncoveredBody(input, parent, given, givenInputs);
  const parts = [...given, ...body];
  // Body pieces get their own seeds, after the given parts, so adding one does not reshuffle the others.
  const inputs = [...givenInputs, ...body.map((part, i) => partInput(input, parent, part, given.length + i))];

  // First pass: resolve every part to learn its wall top, so parts can block each other correctly.
  const specs: (ResolvedSpec | null)[] = inputs.map((p) => {
    try {
      return resolve(p);
    } catch {
      return null; // a degenerate part is left out, the rest of the building still builds
    }
  });
  const bounds = specs.map((s) => (s ? ringBounds(s.footprint.outer) : null));
  // Passages are judged on the whole outline and then cut into each part, so they come out continuous.
  const corridors = buildingCorridors(input, parent);

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
    const mesh = generateOne(
      {
        ...partIn,
        neighbours: [...(input.neighbours ?? []), ...others],
        entrance: i === entrance && input.entrance !== false,
      },
      corridors,
    );
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
