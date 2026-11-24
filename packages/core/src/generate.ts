import { difference, intersection } from './geom/boolean';
import { type Polygon, perimeter, polygonArea, ringArea, ringBounds } from './geom/polygon';
import type { Vec2 } from './geom/vec2';
import { mergeMeshes } from './mesh/merge';
import { assemble } from './pipeline/assemble';
import { autoParts } from './pipeline/autoParts';
import { buildContext } from './pipeline/context';
import { type FacadeHints, layoutFacade } from './pipeline/facade/layout';
import { type Corridor, buildingCorridors, findPassages } from './pipeline/passages';
import { platformRoofs } from './pipeline/platform';
import { resolve } from './pipeline/resolve';
import { buildRoof } from './pipeline/roofs';
import { fitEaves, straightEaves, trimBumps } from './pipeline/roofs/eaves';
import {
  blockingTop,
  frontOf,
  frontPart,
  lidOver,
  partRoofColour,
  partWallColour,
  setVolume,
  volumeOf,
  worshipParts,
} from './pipeline/volumes';
import { applyRoofToWalls, buildWalls } from './pipeline/walls';
import { getStylePack } from './styles/registry';
import type {
  BuildingDebug,
  BuildingInput,
  BuildingMesh,
  NeighbourInput,
  PartInput,
  PartVolume,
  ResolvedSpec,
  RoofGeometry,
  WallContext,
} from './types';

// `performance` exists in browsers, workers and Node, but core is compiled without DOM types.
const clock = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (clock ? clock.now() : 0);

/** Cheap: what the generator would decide for this input, without building geometry. */
export function resolveBuilding(input: BuildingInput): ResolvedSpec {
  const spec = resolve(input);
  setVolume(spec, 'main');
  return spec;
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
  // Towers without mapped parts get a podium, shaft and crown of their own, churches a tower.
  const tiers = autoParts(input);
  if (tiers) return generateParts(input, tiers);
  const worship = worshipParts(input);
  if (worship) return generateParts(worship.input, worship.parts);
  return generateOne(input);
}

/** Churches have their portal at the west end whatever the streets do; other faiths follow the street. */
const facesWest = (spec: ResolvedSpec): boolean =>
  spec.type === 'worship' && (spec.faith === 'christian' || spec.faith === 'orthodox');

/**
 * `corridors`: for a part, the passages found on the whole building; it does not look at the roads itself.
 * `volume`: for a part, its role within the building (see pipeline/volumes.ts).
 * `hints`: for a part, what the facade stage has to know about the whole building.
 */
function generateOne(
  input: BuildingInput,
  corridors?: readonly Corridor[],
  volume: PartVolume = 'main',
  hints?: FacadeHints,
): BuildingMesh {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string): void => {
    const n = now();
    timings[name] = n - t;
    t = n;
  };

  const spec = resolve(input);
  setVolume(spec, volume);
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
  const eave = spec.base + spec.wallHeight;
  // Mapped buttresses in the outline: the roof is built without them, so its eave runs straight.
  const style = getStylePack(spec.packId).types[spec.type];
  const eaves = style.straightEaves ? straightEaves(spec) : null;
  const hippedEnds = style.hippedEnds === true;
  let roof: RoofGeometry;
  if (eaves) {
    // One overhang all round; none when the building stands against a neighbour anywhere.
    const free = context.slice(0, outerCount).every((c) => c.openFraction > 0.5);
    const even = eaves.spec.footprint.outer.map(() => (free ? spec.roof.overhang : 0));
    const built = buildRoof({ spec: eaves.spec, walls: eaves.walls, overhang: even, eave, hippedEnds });
    roof = fitEaves(built, eaves, eave);
    applyRoofToWalls(walls, roof);
    trimBumps(walls, eaves);
  } else {
    roof = buildRoof({ spec, walls, overhang, eave, hippedEnds });
    applyRoofToWalls(walls, roof);
  }
  lap('roof');

  const full = (input.detail ?? 'full') === 'full';
  // A building of its own is its own front part.
  const own: FacadeHints = hints ?? (facesWest(spec) ? { front: frontOf(spec.metrics.box) } : {});
  const facade = full ? layoutFacade(input, spec, walls, context, own) : null;
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
  piece = 0,
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
    faith: input.faith,
    year: input.year,
    hasAddress: input.hasAddress,
    shop: input.shop,
    shopProbability: input.shopProbability,
    balconies: input.balconies,
    roads: input.roads,
    // One palette, era and facade variant for all parts.
    groupKey: input.groupKey ?? `self:${input.seed}`,
    style: input.style,
    // Further pieces of a part split by a courtyard get seeds of their own; the first keeps the part's.
    seed: piece === 0 ? `${input.seed}/part${index}` : `${input.seed}/part${index}.${piece}`,
    baseElevation: input.baseElevation,
    detail: input.detail,
    debug: input.debug,
  };
}

/** A part of a place of worship that starts this far above the ground has the body under it. */
const RAISED = 2.5;
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
  // Places of worship: whatever is mapped above the ground has the building under it (a porch
  // under its mapped roof, the hall under a tower's upper stage), never an open passage.
  const worship = parent.type === 'worship';
  const coversBelow = worship ? parent.base + RAISED : bodyTop - 0.5;
  const covering = parts.filter((_, i) => (inputs[i]?.minHeight ?? 0) < coversBelow).map((p) => p.footprint);
  const outline = { outer: parent.footprint.outer, holes: parent.footprint.holes };
  let pieces = difference(outline, covering);
  if (pieces === null) {
    // Clipping failed. Keep the body whole when the parts clearly do not replace it.
    const covered = covering.reduce((sum, p) => sum + ringArea(p.outer), 0);
    parent.notes.push('could not subtract the parts from the outline');
    pieces = covered < 0.6 * parent.metrics.area ? [outline] : [];
  }
  // Parts mapped above the ground that were not subtracted: the body may lie under them.
  const raised = worship
    ? parts
        .map((p, i) => ({ footprint: p.footprint, base: inputs[i]?.minHeight ?? 0 }))
        .filter((r) => r.base >= coversBelow)
    : [];
  return pieces
    .filter((p) => {
      const area = polygonArea(p);
      return area >= MIN_BODY_AREA && (2 * area) / perimeter(p.outer) >= MIN_BODY_THICKNESS;
    })
    .map((footprint) => {
      // Places of worship: a piece under a raised part (a porch under its mapped roof) ends where that begins.
      const lid = raised.length > 0 ? lidOver(footprint, raised) : undefined;
      if (lid !== undefined && lid > (input.minHeight ?? 0) + 0.5)
        return { footprint, height: lid, minHeight: input.minHeight, roof: { shape: 'flat' as const } };
      return {
        footprint,
        height: input.height,
        minHeight: input.minHeight,
        levels: input.levels,
        roof: input.roof,
      };
    });
}

/** Courtyard overlap below this (m²) is a mapping inaccuracy at the edge, not a part over the courtyard. */
const MIN_COURTYARD_OVERLAP = 1;

/**
 * The parts with the outline's courtyards cut out, each piece with the index of the
 * part it came from.
 *
 * Mappers often draw a `building:part` straight across the courtyard of a
 * multipolygon; the outline's hole says the courtyard is open, and the passages
 * into it need it open. A part the cut splits becomes several pieces. A part lying
 * wholly inside a courtyard is kept: something was mapped there on purpose.
 */
function cutCourtyards(
  parts: readonly PartInput[],
  holes: readonly (readonly Vec2[])[],
  notes: string[],
): { part: PartInput; index: number; piece: number }[] {
  const out: { part: PartInput; index: number; piece: number }[] = [];
  const courtyards: Polygon[] = holes.map((h) => ({ outer: [...h].reverse() }));
  const boxes = courtyards.map((c) => ringBounds(c.outer));
  parts.forEach((part, index) => {
    const box = ringBounds(part.footprint.outer);
    const over = courtyards.filter((c, k) => {
      const b = boxes[k];
      if (!b || b.minX >= box.maxX || b.maxX <= box.minX || b.minY >= box.maxY || b.maxY <= box.minY)
        return false;
      const shared = intersection(part.footprint, c);
      return shared !== null && shared.reduce((sum, p) => sum + polygonArea(p), 0) >= MIN_COURTYARD_OVERLAP;
    });
    const pieces = over.length > 0 ? difference(part.footprint, over) : null;
    if (!pieces || pieces.length === 0) {
      if (over.length > 0 && !pieces) notes.push('could not cut the courtyard out of a part');
      out.push({ part, index, piece: 0 });
      return;
    }
    pieces.forEach((footprint, piece) => {
      out.push({ part: { ...part, footprint }, index, piece });
    });
  });
  return out;
}

function generateParts(input: BuildingInput, mapped: readonly PartInput[]): BuildingMesh {
  const parent = resolve({ ...input, parts: undefined });
  const cut = cutCourtyards(mapped, parent.footprint.holes ?? [], parent.notes);
  const given = cut.map((c) => c.part);
  const givenInputs = cut.map((c) => partInput(input, parent, c.part, c.index, c.piece));
  const body = uncoveredBody(input, parent, given, givenInputs);
  const parts = [...given, ...body];
  // Body pieces get their own seeds, after the given parts, so adding one does not reshuffle the others.
  const inputs = [
    ...givenInputs,
    ...body.map((part, i) => partInput(input, parent, part, mapped.length + i)),
  ];

  // First pass: resolve every part to learn its wall top, so parts can block each other correctly.
  const resolvePart = (p: BuildingInput): ResolvedSpec | null => {
    try {
      return resolve(p);
    } catch {
      return null; // a degenerate part is left out, the rest of the building still builds
    }
  };
  const specs = inputs.map(resolvePart);
  // Places of worship: each part's role picks its rows and tiles; towers without a mapped roof
  // get a pyramid, and parts without a mapped roof colour one that suits their role.
  const worship = parent.type === 'worship';
  const volumes: PartVolume[] = specs.map((s) => (s && worship ? volumeOf(s) : 'main'));
  if (worship)
    volumes.forEach((v, i) => {
      let p = inputs[i];
      let s = specs[i];
      if (!p || !s) return;
      if (v === 'tower' && p.roof?.shape === undefined) {
        p = { ...p, roof: { ...p.roof, shape: 'pyramidal' } };
        s = resolvePart(p);
        if (!s) return;
      }
      const roofColour = partRoofColour(input, p, s, v);
      if (roofColour !== undefined) p = { ...p, colours: { ...p.colours, roof: roofColour } };
      const wallColour = partWallColour(s, v);
      if (wallColour !== undefined) p = { ...p, colours: { ...p.colours, wall: wallColour } };
      if (p === inputs[i]) return;
      inputs[i] = p;
      specs[i] = resolvePart(p);
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
  // Churches: the portal belongs to the west front, whichever part that is (tower, porch, nave).
  const front = facesWest(parent) ? frontOf(parent.metrics.box) : undefined;
  if (front) {
    const foremost = frontPart(specs, volumes, front);
    if (foremost >= 0) entrance = foremost;
  }
  // One tower carries the clock faces: the one with the largest footprint.
  let clockTower = -1;
  specs.forEach((s, i) => {
    if (!s || volumes[i] !== 'tower') return;
    if (clockTower < 0 || s.metrics.area > (specs[clockTower]?.metrics.area ?? 0)) clockTower = i;
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
        height: worship ? blockingTop(other) : other.base + other.wallHeight,
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
      volumes[i],
      { front: i === entrance ? front : undefined, clock: i === clockTower },
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
