/**
 * Facts derived from `BuildingDebug` that the core does not report directly
 * (street wall, door positions). Shared by the plan editor and the inspector.
 */
import type { BuildingDebug, FacadeCell, Vec2 } from '@osm-buildingen/core';

/**
 * Ground-floor tiles that are entrances. The core picks a street wall internally but does
 * not expose it, so the studio infers it from where an entrance tile was placed.
 */
const ENTRANCE_TILES = new Set(['door', 'shopdoor', 'lobby', 'garage_door']);

export interface Entrance {
  wall: number;
  tile: string;
  /** Centre of the entrance on the footprint, input coordinates. */
  position: Vec2;
}

export interface EntranceInfo {
  /** Wall index with the first entrance, or -1 when there is none (massing, no facade). */
  streetWall: number;
  entrances: Entrance[];
}

export function isEntrance(cell: FacadeCell): boolean {
  return cell.row === 0 && ENTRANCE_TILES.has(cell.tile);
}

export function entranceInfo(debug: BuildingDebug | undefined): EntranceInfo {
  const entrances: Entrance[] = [];
  if (!debug?.facade) return { streetWall: -1, entrances };
  for (const cell of debug.facade.cells) {
    if (!isEntrance(cell)) continue;
    const wall = debug.walls[cell.wall];
    if (!wall) continue;
    const t = cell.x + cell.width / 2;
    entrances.push({
      wall: cell.wall,
      tile: cell.tile,
      position: [wall.a[0] + wall.dir[0] * t, wall.a[1] + wall.dir[1] * t],
    });
  }
  // Prefer a real door over a garage door: garages get both on their street wall anyway.
  const main = entrances.find((e) => e.tile !== 'garage_door') ?? entrances[0];
  return { streetWall: main ? main.wall : -1, entrances };
}

/** Facade cells grouped by wall, then by row (row 0 = ground floor). */
export function facadeGrid(debug: BuildingDebug): FacadeCell[][][] {
  const walls: FacadeCell[][][] = debug.walls.map(() => []);
  for (const cell of debug.facade?.cells ?? []) {
    const rows = walls[cell.wall];
    if (!rows) continue;
    const row = rows[cell.row] ?? [];
    rows[cell.row] = row;
    row.push(cell);
  }
  for (const rows of walls) for (const row of rows) row?.sort((a, b) => a.column - b.column);
  return walls;
}
