/**
 * The "generator threads" setting: 0 generates on the main thread, 1–8 use that many
 * workers, 9 uses one worker per hardware thread.
 */
import { type GeneratorPool, createGeneratorPool } from '@osm-buildingen/three';
import { createMainThreadPool } from './main-thread-pool';

export const THREADS_ALL = 9;

/** The setting used when nothing is stored: leaves room for the main thread and tile workers. */
export function defaultThreads(mobile: boolean, hardware: number): number {
  return mobile ? 2 : Math.max(2, Math.min(8, hardware - 4));
}

/** Clamps a stored or URL value to 0–9, falling back to the default. */
export function parseThreads(value: string | null, fallback: number): number {
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(0, Math.min(THREADS_ALL, n)) : fallback;
}

/** Number of workers for a setting; 0 means the main thread. */
export function workerCount(setting: number, hardware: number): number {
  return setting >= THREADS_ALL ? Math.max(1, hardware) : setting;
}

export function threadsLabel(setting: number, hardware: number): string {
  if (setting <= 0) return 'UI thread';
  if (setting >= THREADS_ALL) return `all (${Math.max(1, hardware)})`;
  return String(setting);
}

export function createPool(setting: number, hardware: number): GeneratorPool {
  const count = workerCount(setting, hardware);
  if (count === 0) return createMainThreadPool();
  return createGeneratorPool({
    createWorker: () =>
      new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
    size: count,
  });
}
