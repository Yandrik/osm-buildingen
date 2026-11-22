/**
 * One generation = one `buildInputs` result shown in the scene. Owns the tile
 * scheduler, turns finished tiles into merged meshes, and records timings,
 * failures and (in debug mode) per-building debug summaries.
 *
 * Tiles of the previous generation stay visible until replaced, so a slider drag
 * does not blank the map; they are removed once the new generation is complete.
 */
import type { BuildingInput, BuildingMesh, Vec2 } from '@osm-buildingen/core';
import { type GeneratorPool, mergeBuildings } from '@osm-buildingen/three';
import { Mesh } from 'three';
import { type DebugSummary, summarizeDebug } from './analysis';
import type { AreaBuild, AreaMeta } from './area-build';
import type { SceneView, TileView } from './scene';
import {
  type DetailSetting,
  type Level,
  type Progress,
  type Scheduler,
  type Tile,
  type TileResult,
  assignTiles,
  createScheduler,
  inputForLevel,
  levelFor,
  tileDistance,
  tilesToRegenerate,
} from './tiles';

/** Most buildings per worker message: small enough that every worker gets work early. */
const BATCH_SIZE = 48;

export interface DetailOptions {
  mode: DetailSetting;
  radius: number;
  debug: boolean;
}

export interface TileStat {
  key: string;
  buildings: number;
  level: Level;
  workerMs: number;
  wallMs: number;
  triangles: number;
}

export interface GenerationStats {
  tilesDone: number;
  tilesTotal: number;
  running: boolean;
  /** From `start` to the first tile in the scene. */
  firstTileMs: number | null;
  /** From `start` (or the last re-evaluation) until the queue ran empty. */
  wallMs: number | null;
  /** Sum of worker time over all tiles currently shown. */
  workerMs: number;
  triangles: number;
  vertices: number;
  tiles: TileStat[];
}

export interface GenerationEvents {
  /** A tile mesh was added or replaced (paint overlays, refresh selection). */
  onTile(view: TileView): void;
  onProgress(progress: Progress): void;
  /** The queue ran empty. */
  onIdle(): void;
}

export interface Generation {
  readonly id: number;
  readonly build: AreaBuild;
  readonly tiles: readonly Tile[];
  /** Per building, when generated with `debug: true`. */
  readonly debug: (DebugSummary | undefined)[];
  /** Failed buildings: global index -> message. */
  readonly errors: Map<number, string>;
  /** Triangles per building from the last mesh (0 when failed or not generated yet). */
  readonly triangles: Uint32Array;
  /** Re-checks the wanted level of every tile and regenerates only those that differ. */
  update(options: DetailOptions, force?: boolean): void;
  stats(): GenerationStats;
  cancel(): void;
}

let nextGenerationId = 1;

export function startGeneration(
  build: AreaBuild,
  tileSize: number,
  options: DetailOptions,
  scene: SceneView,
  pool: GeneratorPool,
  concurrency: number,
  events: GenerationEvents,
): Generation {
  const id = nextGenerationId++;
  const meta: readonly AreaMeta[] = build.meta;
  const tiles = assignTiles(
    meta.map((m) => m.centroid),
    tileSize,
  );
  const debug: (DebugSummary | undefined)[] = new Array(build.inputs.length);
  const errors = new Map<number, string>();
  const triangles = new Uint32Array(build.inputs.length);
  const shown = new Map<string, { level: Level; stat: TileStat }>();
  let detail = options;
  let roundStart = performance.now();
  const start = roundStart;
  let firstTileMs: number | null = null;
  let wallMs: number | null = null;
  let cancelled = false;

  const target = (): Vec2 => scene.target();

  const scheduler: Scheduler = createScheduler({
    concurrency,
    batchSize: BATCH_SIZE,
    generate: (inputs) => pool.generate(inputs),
    inputs: (buildings, level) =>
      buildings.map((b) => inputForLevel(build.inputs[b] as BuildingInput, level, detail.debug)),
    priority: (tile) => tileDistance(tile, target()),
    onTile: (result) => {
      if (!cancelled) addTile(result);
    },
    onFailure: (tile, error) => {
      for (const b of tile.buildings) errors.set(b, `Worker failed: ${error.message}`);
    },
    onProgress: (progress) => {
      if (cancelled) return;
      events.onProgress(progress);
      if (!progress.running && wallMs === null) {
        wallMs = performance.now() - roundStart;
        removeStale();
        events.onIdle();
      }
    },
  });

  function removeStale(): void {
    for (const view of [...scene.tiles().values()]) {
      if (view.generation !== id) scene.removeTile(view.key);
    }
  }

  function addTile(result: TileResult): void {
    const { tile } = result;
    const meshes: BuildingMesh[] = [];
    const buildings: number[] = [];
    result.meshes.forEach((mesh, k) => {
      const b = tile.buildings[k] as number;
      const error = result.errors[k];
      if (mesh) {
        meshes.push(mesh);
        buildings.push(b);
        triangles[b] = mesh.indices.length / 3;
        errors.delete(b);
        if (mesh.debug) debug[b] = summarizeDebug(mesh.debug);
        else debug[b] = undefined;
      } else {
        triangles[b] = 0;
        errors.set(b, error ?? 'unknown error');
      }
    });
    const merged = mergeBuildings(meshes);
    const colour = merged.geometry.getAttribute('color').array as Uint8Array;
    const view: TileView = {
      key: tile.key,
      mesh: new Mesh(merged.geometry),
      ranges: merged.ranges,
      buildings,
      baseColours: colour.slice(),
      level: result.level,
      generation: id,
      triangles: (merged.geometry.index?.count ?? 0) / 3,
      vertices: merged.geometry.getAttribute('position').count,
    };
    scene.addTile(view);
    shown.set(tile.key, {
      level: result.level,
      stat: {
        key: tile.key,
        buildings: tile.buildings.length,
        level: result.level,
        workerMs: result.workerMs,
        wallMs: result.wallMs,
        triangles: view.triangles,
      },
    });
    if (firstTileMs === null) firstTileMs = performance.now() - start;
    events.onTile(view);
  }

  function update(next: DetailOptions, force = false): void {
    if (cancelled) return;
    const debugChanged = next.debug !== detail.debug;
    detail = next;
    const current = new Map<string, Level>();
    if (!force && !debugChanged) {
      for (const [key, s] of shown) current.set(key, s.level);
      for (const [key, level] of scheduler.queuedLevels()) current.set(key, level);
    }
    const t = target();
    const jobs = tilesToRegenerate(tiles, current, (tile) => levelFor(tile, detail.mode, t, detail.radius));
    if (jobs.length === 0) {
      if (wallMs === null) {
        // Nothing to generate at all (empty area): finish right away.
        wallMs = performance.now() - roundStart;
        removeStale();
        queueMicrotask(() => events.onIdle());
      }
      return;
    }
    roundStart = performance.now();
    wallMs = null;
    scheduler.schedule(jobs);
  }

  update(options, true);

  return {
    id,
    build,
    tiles,
    debug,
    errors,
    triangles,
    update,
    stats() {
      const progress = scheduler.progress();
      let workerMs = 0;
      let tris = 0;
      let verts = 0;
      const list: TileStat[] = [];
      for (const s of shown.values()) {
        workerMs += s.stat.workerMs;
        list.push(s.stat);
      }
      for (const view of scene.tiles().values()) {
        if (view.generation !== id) continue;
        tris += view.triangles;
        verts += view.vertices;
      }
      return {
        tilesDone: shown.size,
        tilesTotal: tiles.length,
        running: progress.running,
        firstTileMs,
        wallMs,
        workerMs,
        triangles: tris,
        vertices: verts,
        tiles: list,
      };
    },
    cancel() {
      cancelled = true;
      scheduler.cancelAll();
    },
  };
}
