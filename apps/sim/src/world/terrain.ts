import { BufferAttribute, BufferGeometry } from 'three';

/** Height grid of one tile: (grid+1)^2 samples, row 0 = north. */
export class HeightGrid {
  constructor(
    readonly heights: Float32Array,
    readonly grid: number,
    /** Side length in metres. */
    readonly size: number,
  ) {}

  /** Bilinear height at tile-local x (east) and n (north). */
  at(x: number, n: number): number {
    const g = this.grid;
    const u = Math.max(0, Math.min(g - 1e-4, (x / this.size) * g));
    const v = Math.max(0, Math.min(g - 1e-4, ((this.size - n) / this.size) * g));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const w = g + 1;
    const h = this.heights;
    const a = h[j * w + i] as number;
    const b = h[j * w + i + 1] as number;
    const c = h[(j + 1) * w + i] as number;
    const d = h[(j + 1) * w + i + 1] as number;
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
  }

  min(): number {
    let m = Number.POSITIVE_INFINITY;
    for (const v of this.heights) if (v < m) m = v;
    return m;
  }

  max(): number {
    let m = Number.NEGATIVE_INFINITY;
    for (const v of this.heights) if (v > m) m = v;
    return m;
  }
}

const SKIRT = 25;

/**
 * Terrain mesh for one tile in tile-local three.js coordinates: x in [0, size],
 * z in [-size, 0] (north edge at -size). `stride` skips grid samples for distant tiles.
 * Skirts hang down from the border to hide cracks between tiles of different detail.
 */
export function terrainGeometry(grid: HeightGrid, stride: number): BufferGeometry {
  const g = grid.grid;
  const n = Math.max(1, Math.floor(g / stride));
  const step = g / n;
  const w = n + 1;
  const vertices = w * w + 4 * w;
  const pos = new Float32Array(vertices * 3);
  const nor = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const size = grid.size;
  const cell = (size / g) * step;
  const hs = grid.heights;
  const gw = g + 1;
  const sample = (i: number, j: number): number => {
    const ci = Math.max(0, Math.min(g, Math.round(i * step)));
    const cj = Math.max(0, Math.min(g, Math.round(j * step)));
    return hs[cj * gw + ci] as number;
  };

  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pos[k * 3] = (i / n) * size;
      pos[k * 3 + 1] = sample(i, j);
      pos[k * 3 + 2] = -size + (j / n) * size;
      const dx = sample(i + 1, j) - sample(i - 1, j);
      // Row j grows southward (+z), so this is the slope along +z.
      const dz = sample(i, j + 1) - sample(i, j - 1);
      const nx = -dx;
      const ny = 2 * cell;
      const nz = -dz;
      const len = Math.hypot(nx, ny, nz) || 1;
      nor[k * 3] = nx / len;
      nor[k * 3 + 1] = ny / len;
      nor[k * 3 + 2] = nz / len;
      uv[k * 2] = i / n;
      uv[k * 2 + 1] = j / n;
    }
  }

  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      // Counter-clockwise from above: a (NW), c (SW), b (NE) and b, c, d.
      index.push(a, c, b, b, c, d);
    }
  }

  // Skirts: one copy of each border vertex, SKIRT metres lower.
  const border: number[][] = [
    Array.from({ length: w }, (_, i) => i), // north
    Array.from({ length: w }, (_, i) => n * w + i), // south
    Array.from({ length: w }, (_, j) => j * w), // west
    Array.from({ length: w }, (_, j) => j * w + n), // east
  ];
  let v = w * w;
  for (const edge of border) {
    const start = v;
    for (const k of edge) {
      pos[v * 3] = pos[k * 3] as number;
      pos[v * 3 + 1] = (pos[k * 3 + 1] as number) - SKIRT;
      pos[v * 3 + 2] = pos[k * 3 + 2] as number;
      nor[v * 3 + 1] = 1;
      uv[v * 2] = uv[k * 2] as number;
      uv[v * 2 + 1] = uv[k * 2 + 1] as number;
      v++;
    }
    for (let e = 0; e < edge.length - 1; e++) {
      const top0 = edge[e] as number;
      const top1 = edge[e + 1] as number;
      const bot0 = start + e;
      const bot1 = start + e + 1;
      // Double-sided by emitting both windings; skirts are cheap.
      index.push(top0, bot0, top1, top1, bot0, bot1, top0, top1, bot0, top1, bot1, bot0);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
