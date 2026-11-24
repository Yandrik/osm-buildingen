import type { BuildingInput, BuildingMesh } from '@osm-buildingen/core';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface GeneratorPoolOptions {
  /** Creates one worker. Needed because bundlers must see the `new Worker(new URL(...))` call. */
  createWorker: () => Worker;
  /** Number of workers, at least 1. Default: hardware threads minus one, at most 8. */
  size?: number;
}

export interface GenerateResult {
  meshes: (BuildingMesh | null)[];
  errors: (string | null)[];
  /** Milliseconds of generation time inside the worker. */
  time: number;
  /** Milliseconds per building, same order as `meshes`. */
  times: Float32Array;
}

export interface GeneratorPool {
  /** Generates a batch (for example one map tile) on the least busy worker. */
  generate(inputs: BuildingInput[]): Promise<GenerateResult>;
  /** Number of workers. */
  readonly size: number;
  dispose(): void;
}

/**
 * A small pool of generator workers.
 *
 *   const pool = createGeneratorPool({
 *     createWorker: () => new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
 *   });
 *   const { meshes } = await pool.generate(inputsOfOneTile);
 */
export function createGeneratorPool(options: GeneratorPoolOptions): GeneratorPool {
  const threads = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // Only the default is capped: a caller may deliberately want one worker per core.
  const size = Math.max(1, Math.floor(options.size ?? Math.min(8, threads - 1)));
  const workers = Array.from({ length: size }, () => ({ worker: options.createWorker(), busy: 0 }));
  const pending = new Map<
    number,
    { resolve: (r: GenerateResult) => void; reject: (e: Error) => void; slot: number }
  >();
  let nextId = 1;

  workers.forEach((entry, slot) => {
    entry.worker.onmessage = (event: MessageEvent<WorkerResponse>): void => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      entry.busy--;
      job.resolve({
        meshes: event.data.meshes,
        errors: event.data.errors,
        time: event.data.time,
        times: event.data.times,
      });
    };
    entry.worker.onerror = (event: ErrorEvent): void => {
      for (const [id, job] of pending) {
        if (job.slot !== slot) continue;
        pending.delete(id);
        job.reject(new Error(event.message || 'Generator worker failed'));
      }
      entry.busy = 0;
    };
  });

  return {
    size,
    generate(inputs) {
      return new Promise((resolve, reject) => {
        let slot = 0;
        workers.forEach((w, i) => {
          if (w.busy < (workers[slot] as { busy: number }).busy) slot = i;
        });
        const entry = workers[slot] as { worker: Worker; busy: number };
        entry.busy++;
        const id = nextId++;
        pending.set(id, { resolve, reject, slot });
        const request: WorkerRequest = { id, inputs };
        entry.worker.postMessage(request);
      });
    },
    dispose() {
      for (const w of workers) w.worker.terminate();
      for (const job of pending.values()) job.reject(new Error('Generator pool disposed'));
      pending.clear();
    },
  };
}
