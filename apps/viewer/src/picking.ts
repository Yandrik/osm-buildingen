/**
 * Click picking: a raycast against the current tile meshes, mapped back to the
 * global building index through the tile's merge ranges (no per-building objects).
 */
import { buildingAtFace } from '@osm-buildingen/three';
import { Raycaster, Vector2 } from 'three';
import type { SceneView, TileView } from './scene';

export interface PickHit {
  building: number;
  tile: TileView;
  /** Index into `tile.ranges` / `tile.buildings`. */
  local: number;
}

/** Calls `onPick` with the hit, or null for a click on empty ground. Drags do not count. */
export function attachPicking(
  view: SceneView,
  currentGeneration: () => number,
  onPick: (hit: PickHit | null) => void,
): () => void {
  const raycaster = new Raycaster();
  const canvas = view.canvas;
  let down: { x: number; y: number } | null = null;

  const pick = (event: PointerEvent): PickHit | null => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, view.camera);
    const generation = currentGeneration();
    const tiles = [...view.tiles().values()].filter((t) => t.generation === generation);
    const hits = raycaster.intersectObjects(
      tiles.map((t) => t.mesh),
      false,
    );
    for (const hit of hits) {
      const tile = tiles.find((t) => t.mesh === hit.object);
      if (!tile || hit.faceIndex === undefined || hit.faceIndex === null) continue;
      const local = buildingAtFace(tile.ranges, hit.faceIndex);
      const building = tile.buildings[local];
      if (building !== undefined) return { building, tile, local };
    }
    return null;
  };

  const onDown = (event: PointerEvent): void => {
    down = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };
  const onUp = (event: PointerEvent): void => {
    if (!down || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved < 5) onPick(pick(event));
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
  };
}
