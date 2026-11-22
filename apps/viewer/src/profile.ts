/**
 * Profile run: generates every building once on the main thread, timing each call,
 * in short slices so the page stays responsive. The worker protocol only reports
 * time per batch, so this is how per-building times are measured without debug data.
 */
import { type BuildingInput, generateBuilding } from '@osm-buildingen/core';

export interface ProfileEntry {
  index: number;
  ms: number;
  triangles: number;
  error: string | null;
}

export interface ProfileRun {
  promise: Promise<ProfileEntry[] | null>;
  cancel(): void;
}

export function runProfile(
  inputs: readonly BuildingInput[],
  onProgress: (done: number, total: number) => void,
): ProfileRun {
  let cancelled = false;
  const entries: ProfileEntry[] = [];
  const promise = new Promise<ProfileEntry[] | null>((resolve) => {
    let next = 0;
    const step = (): void => {
      if (cancelled) {
        resolve(null);
        return;
      }
      const end = performance.now() + 30;
      while (next < inputs.length && performance.now() < end) {
        const input = inputs[next] as BuildingInput;
        const t0 = performance.now();
        try {
          const mesh = generateBuilding(input);
          entries.push({
            index: next,
            ms: performance.now() - t0,
            triangles: mesh.indices.length / 3,
            error: null,
          });
        } catch (e) {
          entries.push({
            index: next,
            ms: performance.now() - t0,
            triangles: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        next++;
      }
      onProgress(next, inputs.length);
      if (next < inputs.length) setTimeout(step, 0);
      else resolve(entries);
    };
    setTimeout(step, 0);
  });
  return {
    promise,
    cancel() {
      cancelled = true;
    },
  };
}
