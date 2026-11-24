/**
 * A `GeneratorPool` without workers, for the "0 threads" setting. Generation runs on the
 * main thread in slices of a few milliseconds per frame, so a batch of full-detail buildings
 * costs frame time instead of freezing the page.
 */
import { type BuildingMesh, generateBuilding } from '@osm-buildingen/core';
import type { GenerateResult, GeneratorPool } from '@osm-buildingen/three';

interface Job {
  inputs: Parameters<GeneratorPool['generate']>[0];
  next: number;
  meshes: (BuildingMesh | null)[];
  errors: (string | null)[];
  times: Float32Array;
  time: number;
  resolve: (r: GenerateResult) => void;
  reject: (e: Error) => void;
}

export interface MainThreadPoolOptions {
  /** Milliseconds of generation per slice. At least one building runs per slice. */
  budget?: number;
  /** Runs a callback later; defaults to the next animation frame. */
  schedule?: (run: () => void) => void;
  now?: () => number;
}

export function createMainThreadPool(options: MainThreadPoolOptions = {}): GeneratorPool {
  const budget = options.budget ?? 4;
  const schedule =
    options.schedule ??
    (typeof requestAnimationFrame === 'function'
      ? (run: () => void) => requestAnimationFrame(() => run())
      : (run: () => void) => setTimeout(run, 0));
  const now = options.now ?? (() => performance.now());
  const queue: Job[] = [];
  let scheduled = false;
  let disposed = false;

  const slice = (): void => {
    scheduled = false;
    if (disposed) return;
    const start = now();
    while (queue.length > 0) {
      const job = queue[0] as Job;
      const input = job.inputs[job.next];
      if (input) {
        const t0 = now();
        try {
          job.meshes.push(generateBuilding(input));
          job.errors.push(null);
        } catch (error) {
          job.meshes.push(null);
          job.errors.push(error instanceof Error ? error.message : String(error));
        }
        const dt = now() - t0;
        job.times[job.next] = dt;
        job.time += dt;
        job.next++;
      }
      if (job.next >= job.inputs.length) {
        queue.shift();
        job.resolve({ meshes: job.meshes, errors: job.errors, time: job.time, times: job.times });
      }
      if (now() - start >= budget) break;
    }
    if (queue.length > 0) kick();
  };
  const kick = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    schedule(slice);
  };

  return {
    // Reported as 1 so callers that keep `size` batches in flight still make progress.
    size: 1,
    generate(inputs) {
      if (disposed) return Promise.reject(new Error('Generator pool disposed'));
      return new Promise((resolve, reject) => {
        queue.push({
          inputs,
          next: 0,
          meshes: [],
          errors: [],
          times: new Float32Array(inputs.length),
          time: 0,
          resolve,
          reject,
        });
        kick();
      });
    },
    dispose() {
      disposed = true;
      for (const job of queue.splice(0)) job.reject(new Error('Generator pool disposed'));
    },
  };
}
