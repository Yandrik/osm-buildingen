/**
 * Single source of truth for the studio: the `BuildingInput` being edited plus UI state.
 * Pure TypeScript: no DOM, no three.js, so it stays testable and reusable.
 */
import {
  BUILDING_TYPES,
  type BuildingInput,
  type BuildingMesh,
  type ColourInput,
  type NeighbourInput,
  type Polygon,
  ROOF_SHAPES,
  type RoadInput,
  type RoofInput,
  type Vec2,
} from '@osm-buildingen/core';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type Listener<T> = (next: T, prev: T) => void;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (current: T) => T): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<Listener<T>>();
  const set = (next: T): void => {
    if (next === value) return;
    const prev = value;
    value = next;
    for (const l of listeners) l(value, prev);
  };
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// Studio state
// ---------------------------------------------------------------------------

export type PlanTool = 'select' | 'neighbour' | 'road' | 'hole';

/** What is selected in the plan editor. `ring` 0 = outer, 1.. = holes (footprint only). */
export type Selection =
  | { kind: 'footprint'; ring: number; vertex: number | null }
  | { kind: 'neighbour'; index: number; vertex: number | null }
  | { kind: 'road'; index: number; vertex: number | null };

export type CentreLayout = 'split' | '3d' | 'plan';

export interface UiState {
  tool: PlanTool;
  selection: Selection | null;
  layout: CentreLayout;
  wireframe: boolean;
  /** Draw neighbours as grey blocks in the 3D view. */
  showContext: boolean;
  /** Where the current input was imported from; cleared when the footprint is edited. */
  source: InputSource | null;
}

/** An imported input's origin, shown as a chip in the toolbar. */
export interface InputSource {
  osmType: 'way' | 'relation';
  osmId: number;
  /** Outer ring of a multipolygon with several outers (0 for ways). */
  ring: number;
  label: string;
  url: string;
}

export interface StudioState {
  input: BuildingInput;
  ui: UiState;
}

export const DEFAULT_UI: UiState = {
  tool: 'select',
  selection: null,
  layout: 'split',
  wireframe: false,
  showContext: true,
  source: null,
};

/** Result of the latest generation. `mesh` is the last good one; `error` is set when the latest input failed. */
export interface GenerationState {
  mesh: BuildingMesh | null;
  /** The input `mesh` was generated from (identity compare tells whether it is current). */
  meshInput: BuildingInput | null;
  error: string | null;
  /** Wall-clock time of the last generateBuilding call, milliseconds. */
  elapsed: number;
}

export const EMPTY_GENERATION: GenerationState = { mesh: null, meshInput: null, error: null, elapsed: 0 };

// ---------------------------------------------------------------------------
// Immutable input edits. Optional fields set to undefined are removed so the
// exported JSON only contains what the user actually pinned.
// ---------------------------------------------------------------------------

type Patch<T> = { [K in keyof T]?: T[K] | undefined };

/** Copy without the keys whose value is undefined. */
export function prune<T extends object>(value: T): T {
  const out = { ...value };
  for (const key of Object.keys(out) as (keyof T)[]) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

const isEmpty = (o: object): boolean => Object.keys(o).length === 0;

export function patchInput(input: BuildingInput, patch: Patch<BuildingInput>): BuildingInput {
  return prune({ ...input, ...patch } as BuildingInput);
}

export function patchRoof(input: BuildingInput, patch: Patch<RoofInput>): BuildingInput {
  const roof = prune({ ...input.roof, ...patch } as RoofInput);
  return patchInput(input, { roof: isEmpty(roof) ? undefined : roof });
}

export function patchColours(input: BuildingInput, patch: Patch<ColourInput>): BuildingInput {
  const colours = prune({ ...input.colours, ...patch } as ColourInput);
  return patchInput(input, { colours: isEmpty(colours) ? undefined : colours });
}

export function setRing(input: BuildingInput, ring: number, points: Vec2[]): BuildingInput {
  if (ring === 0) return patchInput(input, { footprint: { ...input.footprint, outer: points } });
  const holes = [...(input.footprint.holes ?? [])];
  holes[ring - 1] = points;
  return patchInput(input, { footprint: { ...input.footprint, holes } });
}

export function getRing(polygon: Polygon, ring: number): readonly Vec2[] {
  return ring === 0 ? polygon.outer : (polygon.holes?.[ring - 1] ?? []);
}

export function setNeighbour(input: BuildingInput, index: number, n: NeighbourInput | null): BuildingInput {
  const list = [...(input.neighbours ?? [])];
  if (n) list[index] = n;
  else list.splice(index, 1);
  return patchInput(input, { neighbours: list.length ? list : undefined });
}

export function setRoad(input: BuildingInput, index: number, r: RoadInput | null): BuildingInput {
  const list = [...(input.roads ?? [])];
  if (r) list[index] = r;
  else list.splice(index, 1);
  return patchInput(input, { roads: list.length ? list : undefined });
}

/** The input as the user sees it: without the `debug` flag the studio adds when generating. */
export function exportableInput(input: BuildingInput): BuildingInput {
  return patchInput(input, { debug: undefined });
}

// ---------------------------------------------------------------------------
// Validation of untrusted JSON (paste, permalink, storage)
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isRing = (v: unknown): v is Vec2[] => Array.isArray(v) && v.every(isVec2);

function isPolygon(v: unknown): v is Polygon {
  if (!isObject(v) || !isRing(v.outer)) return false;
  return v.holes === undefined || (Array.isArray(v.holes) && v.holes.every(isRing));
}

const ROAD_KINDS: readonly unknown[] = ['road', 'path', 'rail'];

/** First optional field with the wrong type, as an error message; null when all are fine. */
function badFields(
  o: Record<string, unknown>,
  numbers: readonly string[],
  booleans: readonly string[],
): string | null {
  for (const k of numbers) {
    const v = o[k];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) return `${k} must be a number.`;
  }
  for (const k of booleans) {
    if (o[k] !== undefined && typeof o[k] !== 'boolean') return `${k} must be true or false.`;
  }
  return null;
}

/**
 * Checks the shape of a parsed JSON value well enough that the UI cannot crash on it.
 * Geometry problems (too few points, zero area) are left to the generator, which reports them.
 */
export function parseInput(value: unknown): { input: BuildingInput } | { error: string } {
  if (!isObject(value)) return { error: 'Input must be a JSON object.' };
  if (!isPolygon(value.footprint))
    return { error: 'footprint must be { outer: [x, y][], holes?: [x, y][][] }.' };
  if (!isObject(value.style)) return { error: 'style must be { region, modernity }.' };
  const { region, modernity } = value.style;
  if (region !== 'de' && region !== 'us') return { error: "style.region must be 'de' or 'us'." };
  if (typeof modernity !== 'number') return { error: 'style.modernity must be a number.' };
  if (typeof value.seed !== 'string' && typeof value.seed !== 'number') {
    return { error: 'seed must be a string or a number.' };
  }
  if (value.type !== undefined && !(BUILDING_TYPES as readonly unknown[]).includes(value.type)) {
    return { error: `Unknown type ${JSON.stringify(value.type)}.` };
  }
  if (value.roof !== undefined) {
    if (!isObject(value.roof)) return { error: 'roof must be an object.' };
    const shape = value.roof.shape;
    if (shape !== undefined && !(ROOF_SHAPES as readonly unknown[]).includes(shape)) {
      return { error: `Unknown roof shape ${JSON.stringify(shape)}.` };
    }
  }
  if (value.parts !== undefined) {
    if (!Array.isArray(value.parts) || !value.parts.every((p) => isObject(p) && isPolygon(p.footprint))) {
      return {
        error: 'parts must be [{ footprint, height?, minHeight?, levels?, minLevel?, roof?, colours? }].',
      };
    }
    for (const [i, p] of (value.parts as Record<string, unknown>[]).entries()) {
      const bad = badFields(p, ['height', 'minHeight', 'levels', 'minLevel'], []);
      if (bad) return { error: `parts[${i}].${bad}` };
      if (p.roof !== undefined && !isObject(p.roof)) return { error: `parts[${i}].roof must be an object.` };
    }
  }
  if (value.neighbours !== undefined) {
    if (
      !Array.isArray(value.neighbours) ||
      !value.neighbours.every((n) => isObject(n) && isPolygon(n.footprint))
    ) {
      return { error: 'neighbours must be [{ footprint, height?, minHeight?, sameGroup? }].' };
    }
    for (const [i, n] of (value.neighbours as Record<string, unknown>[]).entries()) {
      const bad = badFields(n, ['height', 'minHeight'], ['sameGroup']);
      if (bad) return { error: `neighbours[${i}].${bad}` };
    }
  }
  if (value.roads !== undefined) {
    if (!Array.isArray(value.roads) || !value.roads.every((r) => isObject(r) && isRing(r.line))) {
      return { error: 'roads must be [{ line: [x, y][], width?, kind?, passage? }].' };
    }
    for (const [i, r] of (value.roads as Record<string, unknown>[]).entries()) {
      const bad = badFields(r, ['width'], ['passage']);
      if (bad) return { error: `roads[${i}].${bad}` };
      if (r.kind !== undefined && !ROAD_KINDS.includes(r.kind)) {
        return { error: `roads[${i}].kind must be one of ${ROAD_KINDS.join(', ')}.` };
      }
    }
  }
  const bad = badFields(
    value,
    ['height', 'levels', 'minHeight', 'year', 'shopProbability', 'baseElevation'],
    ['hasAddress', 'shop', 'balconies', 'entrance', 'debug'],
  );
  if (bad) return { error: bad };
  if (value.groupKey !== undefined && typeof value.groupKey !== 'string') {
    return { error: 'groupKey must be a string.' };
  }
  if (value.detail !== undefined && value.detail !== 'massing' && value.detail !== 'full') {
    return { error: "detail must be 'massing' or 'full'." };
  }
  // The checks above cover everything the studio reads structurally; other fields pass through.
  return { input: value as unknown as BuildingInput };
}
