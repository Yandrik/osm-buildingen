/**
 * Entrance positions and the facade grid, read from `BuildingDebug`.
 * Shared by the plan editor and the inspector.
 */
import type { BuildingDebug, FacadeCell, Vec2 } from '@osm-buildingen/core';

export interface Entrance {
  wall: number;
  tile: string;
  role: FacadeCell['role'];
  /** Centre of the entrance on the footprint, input coordinates. */
  position: Vec2;
}

export interface EntranceInfo {
  /** Wall the generator chose for the entrance, or -1 (massing, no facade, entrance: false). */
  streetWall: number;
  entrances: Entrance[];
}

const ENTRANCE_ROLES = new Set(['door', 'shopdoor', 'garage', 'dock']);

export function isEntrance(cell: FacadeCell): boolean {
  return cell.row === 0 && ENTRANCE_ROLES.has(cell.role);
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
      role: cell.role,
      position: [wall.a[0] + wall.dir[0] * t, wall.a[1] + wall.dir[1] * t],
    });
  }
  return { streetWall: debug.facade.streetWall, entrances };
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
