/**
 * Tiling and generation scheduling. Plain functions plus a scheduler that gets the
 * generator injected, so all of it runs (and is tested) without workers or three.js.
 *
 * Tiles are squares in the shared local metre frame (x east, y north), aligned to
 * the origin. A building belongs to the tile containing its centroid. Each tile is
 * cut into batches so a big tile still spreads over all workers; the tile is
 * handed back once all its batches are done.
 */
import type { BuildingInput, BuildingMesh, Vec2 } from '@osm-buildingen/core';

export type Level = 'full' | 'massing';

export interface Tile {
  /** "i,j" grid index. */
  key: string;
  i: number;
  j: number;
  /** Square in local metres: [minX, minY] .. [minX + size, minY + size]. */
  minX: number;
  minY: number;
  size: number;
  /** Global building indices (into inputs / meta), ascending. */
  buildings: number[];
}

export function tileKey(i: number, j: number): string {
  return `${i},${j}`;
}

/** Groups buildings by the tile that contains their centroid. Tiles come back sorted by key order (j, then i). */
export function assignTiles(centroids: readonly Vec2[], size: number): Tile[] {
  const tiles = new Map<string, Tile>();
  centroids.forEach(([x, y], index) => {
    const i = Math.floor(x / size);
    const j = Math.floor(y / size);
    const key = tileKey(i, j);
    let tile = tiles.get(key);
    if (!tile) {
      tile = { key, i, j, minX: i * size, minY: j * size, size, buildings: [] };
      tiles.set(key, tile);
    }
    tile.buildings.push(index);
  });
  return [...tiles.values()].sort((a, b) => a.j - b.j || a.i - b.i);
}

/** Distance from a point to the tile square (0 inside). */
export function tileDistance(tile: Tile, [x, y]: Vec2): number {
  const dx = Math.max(tile.minX - x, 0, x - (tile.minX + tile.size));
  const dy = Math.max(tile.minY - y, 0, y - (tile.minY + tile.size));
  return Math.hypot(dx, dy);
}

/** Tiles nearest to `target` first; ties broken by key so the order is stable. */
export function orderByDistance(tiles: readonly Tile[], target: Vec2): Tile[] {
  const centre = (t: Tile): number =>
    Math.hypot(t.minX + t.size / 2 - target[0], t.minY + t.size / 2 - target[1]);
  return [...tiles].sort(
    (a, b) =>
      tileDistance(a, target) - tileDistance(b, target) || centre(a) - centre(b) || a.j - b.j || a.i - b.i,
  );
}

export type DetailSetting = 'full' | 'massing' | 'auto';

export function levelFor(tile: Tile, mode: DetailSetting, target: Vec2, radius: number): Level {
  if (mode !== 'auto') return mode;
  return tileDistance(tile, target) <= radius ? 'full' : 'massing';
}

/** Tiles whose wanted level differs from the one they have (or are being generated at). */
export function tilesToRegenerate(
  tiles: readonly Tile[],
  current: ReadonlyMap<string, Level>,
  wanted: (tile: Tile) => Level,
): { tile: Tile; level: Level }[] {
  const out: { tile: Tile; level: Level }[] = [];
  for (const tile of tiles) {
    const level = wanted(tile);
    if (current.get(tile.key) !== level) out.push({ tile, level });
  }
  return out;
}

/** Splits `items` into the fewest nearly equal consecutive chunks of at most `maxPerChunk`. */
export function splitEven<T>(items: readonly T[], maxPerChunk: number): T[][] {
  if (items.length === 0) return [];
  const parts = Math.ceil(items.length / Math.max(1, maxPerChunk));
  const per = Math.ceil(items.length / parts);
  const out: T[][] = [];
  for (let k = 0; k < items.length; k += per) out.push(items.slice(k, k + per));
  return out;
}

/**
 * Input for a tile at a level. `massing` forces massing; `full` keeps the adapter's
 * choice (special buildings stay massing). `debug` is set only when asked for.
 */
export function inputForLevel(input: BuildingInput, level: Level, debug: boolean): BuildingInput {
  const detail = level === 'massing' ? 'massing' : input.detail;
  if (detail === input.detail && !debug && !input.debug) return input;
  return { ...input, detail, debug: debug || undefined };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface BatchResult {
  meshes: (BuildingMesh | null)[];
  errors: (string | null)[];
  /** Worker milliseconds. */
  time: number;
}

export interface TileResult {
  tile: Tile;
  level: Level;
  /** Aligned with `tile.buildings`. */
  meshes: (BuildingMesh | null)[];
  errors: (string | null)[];
  /** Sum of worker milliseconds over the tile's batches. */
  workerMs: number;
  /** From the first batch being sent to the last one coming back. */
  wallMs: number;
}

export interface SchedulerOptions {
  /** Batches in flight at once; normally the pool size. */
  concurrency: number;
  /** Most buildings per batch. */
  batchSize: number;
  generate(inputs: BuildingInput[]): Promise<BatchResult>;
  /** Inputs for a slice of a tile at a level (called when the batch is sent). */
  inputs(buildings: readonly number[], level: Level): BuildingInput[];
  /** Lower runs first; evaluated whenever a batch is picked, so it can follow the camera. */
  priority(tile: Tile): number;
  onTile(result: TileResult): void;
  /** A batch failed as a whole (worker crashed). The tile is dropped. */
  onFailure(tile: Tile, error: Error): void;
  onProgress(progress: Progress): void;
  now?: () => number;
}

export interface Progress {
  done: number;
  total: number;
  running: boolean;
}

interface Job {
  tile: Tile;
  level: Level;
  batches: number[][];
  /** Next batch to send. */
  next: number;
  pending: number;
  results: (BatchResult | undefined)[];
  started: number;
  cancelled: boolean;
}

export interface Scheduler {
  /** Adds jobs; a job for a tile that is already queued or running replaces it. */
  schedule(jobs: readonly { tile: Tile; level: Level }[]): void;
  /** Drops everything; results of batches still in flight are ignored. */
  cancelAll(): void;
  /** Level each tile is queued or running at. */
  queuedLevels(): Map<string, Level>;
  progress(): Progress;
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const now = options.now ?? (() => performance.now());
  const jobs = new Map<string, Job>();
  let inFlight = 0;
  let done = 0;
  let total = 0;

  const progress = (): Progress => ({ done, total, running: jobs.size > 0 });
  const report = (): void => options.onProgress(progress());

  function pickJob(): Job | null {
    let best: Job | null = null;
    let bestKey = 0;
    for (const job of jobs.values()) {
      if (job.next >= job.batches.length) continue;
      // Finish tiles that have started before opening new ones: the first tile appears sooner.
      const key = (job.next > 0 ? 0 : 1e12) + options.priority(job.tile);
      if (!best || key < bestKey) {
        best = job;
        bestKey = key;
      }
    }
    return best;
  }

  function finish(job: Job): void {
    jobs.delete(job.tile.key);
    done++;
    const meshes: (BuildingMesh | null)[] = [];
    const errors: (string | null)[] = [];
    let workerMs = 0;
    for (const r of job.results) {
      if (!r) continue;
      meshes.push(...r.meshes);
      errors.push(...r.errors);
      workerMs += r.time;
    }
    options.onTile({
      tile: job.tile,
      level: job.level,
      meshes,
      errors,
      workerMs,
      wallMs: now() - job.started,
    });
  }

  function pump(): void {
    while (inFlight < options.concurrency) {
      const job = pickJob();
      if (!job) break;
      const index = job.next++;
      if (index === 0) job.started = now();
      const buildings = job.batches[index] as number[];
      job.pending++;
      inFlight++;
      options
        .generate(options.inputs(buildings, job.level))
        .then(
          (result) => {
            if (job.cancelled) return;
            job.results[index] = result;
            job.pending--;
            if (job.pending === 0 && job.next >= job.batches.length) finish(job);
          },
          (error: unknown) => {
            if (job.cancelled) return;
            job.cancelled = true;
            jobs.delete(job.tile.key);
            done++;
            options.onFailure(job.tile, error instanceof Error ? error : new Error(String(error)));
          },
        )
        .finally(() => {
          inFlight--;
          pump();
          report();
        });
    }
  }

  return {
    schedule(list) {
      // A new round after an idle period counts from zero again.
      if (jobs.size === 0) {
        done = 0;
        total = 0;
      }
      for (const { tile, level } of list) {
        const old = jobs.get(tile.key);
        if (old) {
          old.cancelled = true;
          total--;
        }
        const batches = splitEven(tile.buildings, options.batchSize);
        if (batches.length === 0) continue;
        jobs.set(tile.key, {
          tile,
          level,
          batches,
          next: 0,
          pending: 0,
          results: [],
          started: 0,
          cancelled: false,
        });
        total++;
      }
      pump();
      report();
    },
    cancelAll() {
      for (const job of jobs.values()) job.cancelled = true;
      jobs.clear();
      done = 0;
      total = 0;
      report();
    },
    queuedLevels() {
      return new Map([...jobs.values()].map((j) => [j.tile.key, j.level]));
    },
    progress,
  };
}
