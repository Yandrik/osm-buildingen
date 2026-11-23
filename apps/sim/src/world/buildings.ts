/**
 * Building cells (~200 m squares). Every cell in range is generated as massing; cells within
 * the configured HQ distance are generated again at full detail and swapped in. The massing mesh is
 * kept while the full one shows, so dropping back is instant.
 */
import type { BuildingInput, BuildingMesh } from '@osm-buildingen/core';
import { type GeneratorPool, mergeBuildings } from '@osm-buildingen/three';
import { Group, type Material, Mesh } from 'three';
import { CELL, tileOrigin } from './frame';
import type { CellInputs } from './inputs';

const FULL_DETAIL_HYSTERESIS = 60;
const FULL_BATCH = 24;

export interface Footprint {
  /** e, n pairs in world metres. */
  ring: Float64Array;
  box: [number, number, number, number];
  base: number;
  top: number;
}

interface Cell {
  key: string;
  tileKey: string;
  e0: number;
  n0: number;
  inputs: BuildingInput[];
  massingOnly: Set<number>;
  massing: Mesh | null;
  full: Mesh | null;
  pending: 0 | 1 | 2;
  footprints: Footprint[];
  /** Distance from the player at the last update. */
  d: number;
  removed: boolean;
}

export class Buildings {
  readonly group = new Group();
  /** Full-detail entry radius in metres, capped by the overall building radius. */
  highQualityDistance = 200;
  private readonly cells = new Map<string, Cell>();
  private inflight = 0;
  /** Stats for the HUD. */
  stats = { cells: 0, massing: 0, full: 0, pending: 0, triangles: 0 };

  constructor(
    private readonly pool: GeneratorPool,
    private readonly material: Material,
  ) {
    this.group.name = 'buildings';
  }

  addTile(tx: number, ty: number, cells: CellInputs[]): void {
    const o = tileOrigin(tx, ty);
    const tileKey = `${tx}/${ty}`;
    for (const c of cells) {
      const e0 = o.e + c.cx * CELL;
      const n0 = o.n + c.cy * CELL;
      const footprints: Footprint[] = c.inputs.map((input) => {
        const outer = input.footprint.outer;
        const ring = new Float64Array(outer.length * 2);
        let minE = Number.POSITIVE_INFINITY;
        let minN = Number.POSITIVE_INFINITY;
        let maxE = Number.NEGATIVE_INFINITY;
        let maxN = Number.NEGATIVE_INFINITY;
        outer.forEach(([x, y], i) => {
          const e = e0 + x;
          const n = n0 + y;
          ring[i * 2] = e;
          ring[i * 2 + 1] = n;
          minE = Math.min(minE, e);
          minN = Math.min(minN, n);
          maxE = Math.max(maxE, e);
          maxN = Math.max(maxN, n);
        });
        const base = input.baseElevation ?? 0;
        return { ring, box: [minE, minN, maxE, maxN], base, top: base + 15 };
      });
      const key = `${tileKey}/${c.cx}/${c.cy}`;
      this.cells.set(key, {
        key,
        tileKey,
        e0,
        n0,
        inputs: c.inputs,
        massingOnly: new Set(c.massingOnly),
        massing: null,
        full: null,
        pending: 0,
        footprints,
        d: Number.POSITIVE_INFINITY,
        removed: false,
      });
    }
  }

  removeTile(tx: number, ty: number): void {
    const tileKey = `${tx}/${ty}`;
    for (const [key, cell] of this.cells) {
      if (cell.tileKey !== tileKey) continue;
      this.drop(cell, 'massing');
      this.drop(cell, 'full');
      cell.removed = true;
      this.cells.delete(key);
    }
  }

  /** `height` is the player's height above the ground; full detail uses 3D distance. */
  update(e: number, n: number, height: number, massRadius: number): void {
    const fullRadius = Math.min(this.highQualityDistance, massRadius);
    const wanted: { cell: Cell; level: 1 | 2 }[] = [];
    let massing = 0;
    let full = 0;
    let triangles = 0;
    for (const cell of this.cells.values()) {
      const dx = Math.max(0, cell.e0 - e, e - (cell.e0 + CELL));
      const dn = Math.max(0, cell.n0 - n, n - (cell.n0 + CELL));
      const d = Math.hypot(dx, dn);
      cell.d = d;
      const d3 = Math.hypot(d, Math.max(0, height - 20));
      const keepFull = d3 < fullRadius + (cell.full ? FULL_DETAIL_HYSTERESIS : 0);
      if (d > massRadius + Math.max(150, massRadius * 0.3)) {
        this.drop(cell, 'massing');
        this.drop(cell, 'full');
      } else if (!keepFull) {
        this.drop(cell, 'full');
      }
      if (d < massRadius && !cell.massing && cell.pending === 0) wanted.push({ cell, level: 1 });
      else if (keepFull && cell.massing && !cell.full && cell.pending === 0) wanted.push({ cell, level: 2 });
      if (cell.massing) cell.massing.visible = !cell.full;
      if (cell.massing) massing++;
      if (cell.full) full++;
      const shown = cell.full ?? cell.massing;
      if (shown) triangles += (shown.geometry.index?.count ?? 0) / 3;
    }
    // Full detail first (it is right next to the player), then massing nearest first.
    wanted.sort((a, b) => b.level - a.level || a.cell.d - b.cell.d);
    const capacity = this.pool.size + 2;
    for (const w of wanted) {
      if (this.inflight >= capacity) break;
      this.generate(w.cell, w.level);
    }
    this.stats = { cells: this.cells.size, massing, full, pending: this.inflight, triangles };
  }

  /** Buildings of the cells near a point, for collisions. */
  *near(e: number, n: number, radius: number): Iterable<Footprint> {
    for (const cell of this.cells.values()) {
      if (e < cell.e0 - radius || e > cell.e0 + CELL + radius) continue;
      if (n < cell.n0 - radius || n > cell.n0 + CELL + radius) continue;
      yield* cell.footprints;
    }
  }

  private async generate(cell: Cell, level: 1 | 2): Promise<void> {
    cell.pending = level;
    const detail = level === 2 ? 'full' : 'massing';
    const inputs = cell.inputs.map(
      (input, i) => ({ ...input, detail: cell.massingOnly.has(i) ? 'massing' : detail }) as BuildingInput,
    );
    const batches: BuildingInput[][] = [];
    const size = level === 2 ? FULL_BATCH : inputs.length;
    for (let i = 0; i < inputs.length; i += size) batches.push(inputs.slice(i, i + size));
    this.inflight += batches.length;
    let meshes: (BuildingMesh | null)[] = [];
    try {
      const results = await Promise.all(
        batches.map((b) =>
          this.pool.generate(b).finally(() => {
            this.inflight--;
          }),
        ),
      );
      meshes = results.flatMap((r) => r.meshes);
    } catch (error) {
      console.warn('building generation failed', cell.key, error);
    }
    cell.pending = 0;
    if (cell.removed) return;
    if (level === 1) {
      meshes.forEach((m, i) => {
        const f = cell.footprints[i];
        if (m && f) f.top = m.bounds.max[1];
        else if (f) f.top = f.base;
      });
    }
    const present = meshes.filter((m): m is BuildingMesh => m !== null);
    if (present.length === 0) return;
    const { geometry } = mergeBuildings(present);
    const mesh = new Mesh(geometry, this.material);
    mesh.position.set(cell.e0, 0, -cell.n0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    if (level === 1) {
      this.drop(cell, 'massing');
      cell.massing = mesh;
    } else {
      this.drop(cell, 'full');
      cell.full = mesh;
      if (cell.massing) cell.massing.visible = false;
    }
  }

  private drop(cell: Cell, which: 'massing' | 'full'): void {
    const mesh = cell[which];
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    cell[which] = null;
    if (which === 'full' && cell.massing) cell.massing.visible = true;
  }
}
