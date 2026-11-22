/// <reference lib="webworker" />
/**
 * Worker entry: generates buildings off the main thread.
 * Use through `createGeneratorPool`; bundlers pick this file up via
 * `new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' })`.
 */
import { type BuildingInput, type BuildingMesh, generateBuilding } from '@osm-buildingen/core';

export interface WorkerRequest {
  id: number;
  inputs: BuildingInput[];
}
export interface WorkerResponse {
  id: number;
  /** null where generation threw; the matching entry in `errors` says why. */
  meshes: (BuildingMesh | null)[];
  errors: (string | null)[];
  /** Milliseconds spent generating. */
  time: number;
  /** Milliseconds per building, same order as `meshes`. */
  times: Float32Array;
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, inputs } = event.data;
  const meshes: (BuildingMesh | null)[] = [];
  const errors: (string | null)[] = [];
  const transfer: Transferable[] = [];
  const start = performance.now();
  const times = new Float32Array(inputs.length);
  inputs.forEach((input, index) => {
    const t0 = performance.now();
    try {
      const mesh = generateBuilding(input);
      meshes.push(mesh);
      errors.push(null);
      transfer.push(mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.indices.buffer);
    } catch (error) {
      meshes.push(null);
      errors.push(error instanceof Error ? error.message : String(error));
    }
    times[index] = performance.now() - t0;
  });
  const response: WorkerResponse = { id, meshes, errors, time: performance.now() - start, times };
  transfer.push(times.buffer);
  self.postMessage(response, transfer);
};
