/**
 * Per-building facts the overlays and stats need beyond the mesh:
 * - `DebugSummary`, distilled from `mesh.debug` when the workers ran with `debug: true`
 *   (the full debug object is dropped right away to keep memory flat);
 * - resolved specs (type, era), computed lazily on the main thread with
 *   `resolveBuilding`, which is cheap (no geometry) and needs no worker round trip.
 */
import {
  type BuildingDebug,
  type BuildingInput,
  type ResolvedSpec,
  generateBuilding,
  resolveBuilding,
} from '@osm-buildingen/core';

export interface DebugSummary {
  notes: string[];
  /** The facade solver gave up somewhere and filled with blank tiles. */
  facadeFallback: boolean;
  /** Sum of `debug.timings` (all parts), milliseconds. */
  ms: number;
}

export function summarizeDebug(debug: BuildingDebug): DebugSummary {
  const parts = debug.parts && debug.parts.length > 0 ? debug.parts : [debug];
  const notes: string[] = [];
  let facadeFallback = false;
  let ms = 0;
  parts.forEach((p, i) => {
    const prefix = parts.length > 1 ? `part ${i}: ` : '';
    for (const n of p.spec.notes) notes.push(prefix + n);
    if (p.facade?.fallback) facadeFallback = true;
    for (const v of Object.values(p.timings)) ms += v;
  });
  return { notes, facadeFallback, ms };
}

export interface Inspection {
  /** Null when the generator threw. */
  debug: BuildingDebug | null;
  error: string | null;
  triangles: number;
  vertices: number;
  /** Main-thread wall time of this one `generateBuilding` call (debug on). */
  ms: number;
}

/** Generates one building with `debug: true` on the main thread, for the inspector. */
export function inspectBuilding(input: BuildingInput, level: 'full' | 'massing'): Inspection {
  const t0 = performance.now();
  try {
    const mesh = generateBuilding({
      ...input,
      detail: level === 'massing' ? 'massing' : input.detail,
      debug: true,
    });
    return {
      debug: mesh.debug ?? null,
      error: null,
      triangles: mesh.indices.length / 3,
      vertices: mesh.positions.length / 3,
      ms: performance.now() - t0,
    };
  } catch (e) {
    return {
      debug: null,
      error: e instanceof Error ? e.message : String(e),
      triangles: 0,
      vertices: 0,
      ms: performance.now() - t0,
    };
  }
}

export interface ResolveCache {
  /** Null when resolving threw (the generator would fail for this building too). */
  get(index: number): ResolvedSpec | null;
  /** True once every building is resolved. */
  complete(): boolean;
  /** Resolves the rest in time slices; `onDone` runs once, unless `cancel` was called first. */
  fill(onDone: () => void): void;
  cancel(): void;
}

export function createResolveCache(inputs: readonly BuildingInput[]): ResolveCache {
  const specs: (ResolvedSpec | null | undefined)[] = new Array(inputs.length);
  let filled = 0;
  let timer = 0;
  let cancelled = false;

  const resolveAt = (i: number): ResolvedSpec | null => {
    let s = specs[i];
    if (s !== undefined) return s;
    try {
      s = resolveBuilding(inputs[i] as BuildingInput);
    } catch {
      s = null;
    }
    specs[i] = s;
    return s;
  };

  return {
    get: resolveAt,
    complete: () => filled >= inputs.length,
    fill(onDone) {
      cancelled = false;
      clearTimeout(timer);
      const step = (): void => {
        if (cancelled) return;
        const end = performance.now() + 12;
        while (filled < inputs.length && performance.now() < end) resolveAt(filled++);
        if (filled < inputs.length) timer = window.setTimeout(step, 0);
        else onDone();
      };
      step();
    },
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
