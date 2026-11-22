/** The generator worker pool. Kept apart so the worker URL form lives in one place. */
import { type GeneratorPool, createGeneratorPool } from '@osm-buildingen/three';

export const POOL_SIZE = Math.max(
  1,
  Math.min(8, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4) - 1),
);

export function createPool(): GeneratorPool {
  return createGeneratorPool({
    size: POOL_SIZE,
    createWorker: () =>
      new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
  });
}
