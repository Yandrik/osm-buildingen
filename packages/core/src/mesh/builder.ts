import earcut from 'earcut';
import type { Colour } from '../colour';
import type { BuildingMesh, Vec3 } from '../types';

/**
 * Appends flat-shaded faces to growable typed arrays.
 *
 * Every face owns its vertices and carries one normal and one colour.
 * Faces must be given counter-clockwise as seen from outside.
 */
export class MeshBuilder {
  private positions = new Float32Array(3 * 1024);
  private normals = new Float32Array(3 * 1024);
  private colors = new Uint8Array(3 * 1024);
  private indices = new Uint32Array(6 * 512);
  private vertexCount = 0;
  private indexCount = 0;

  get triangleCount(): number {
    return this.indexCount / 3;
  }

  private reserve(vertices: number, indices: number): void {
    const needV = (this.vertexCount + vertices) * 3;
    if (needV > this.positions.length) {
      const size = Math.max(needV, this.positions.length * 2);
      const p = new Float32Array(size);
      p.set(this.positions);
      this.positions = p;
      const n = new Float32Array(size);
      n.set(this.normals);
      this.normals = n;
      const c = new Uint8Array(size);
      c.set(this.colors);
      this.colors = c;
    }
    const needI = this.indexCount + indices;
    if (needI > this.indices.length) {
      const i = new Uint32Array(Math.max(needI, this.indices.length * 2));
      i.set(this.indices);
      this.indices = i;
    }
  }

  private push(p: Vec3, nx: number, ny: number, nz: number, colour: Colour): number {
    const o = this.vertexCount * 3;
    this.positions[o] = p[0];
    this.positions[o + 1] = p[1];
    this.positions[o + 2] = p[2];
    this.normals[o] = nx;
    this.normals[o + 1] = ny;
    this.normals[o + 2] = nz;
    this.colors[o] = (colour >> 16) & 0xff;
    this.colors[o + 1] = (colour >> 8) & 0xff;
    this.colors[o + 2] = colour & 0xff;
    return this.vertexCount++;
  }

  tri(a: Vec3, b: Vec3, c: Vec3, colour: Colour): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return; // degenerate
    nx /= l;
    ny /= l;
    nz /= l;
    this.reserve(3, 3);
    const i = this.push(a, nx, ny, nz, colour);
    this.push(b, nx, ny, nz, colour);
    this.push(c, nx, ny, nz, colour);
    this.indices[this.indexCount++] = i;
    this.indices[this.indexCount++] = i + 1;
    this.indices[this.indexCount++] = i + 2;
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: Colour): void {
    // Newell normal: robust for slightly non-planar quads and for one collapsed edge.
    const pts = [a, b, c, d];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < 4; i++) {
      const p = pts[i] as Vec3;
      const q = pts[(i + 1) % 4] as Vec3;
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    nx /= l;
    ny /= l;
    nz /= l;
    this.reserve(4, 6);
    const i = this.push(a, nx, ny, nz, colour);
    this.push(b, nx, ny, nz, colour);
    this.push(c, nx, ny, nz, colour);
    this.push(d, nx, ny, nz, colour);
    this.indices[this.indexCount++] = i;
    this.indices[this.indexCount++] = i + 1;
    this.indices[this.indexCount++] = i + 2;
    this.indices[this.indexCount++] = i;
    this.indices[this.indexCount++] = i + 2;
    this.indices[this.indexCount++] = i + 3;
  }

  /** Planar polygon with optional holes, triangulated in its own plane. */
  polygon(points: readonly Vec3[], colour: Colour, holes: readonly (readonly Vec3[])[] = []): void {
    const n = points.length;
    if (n < 3) return;
    if (n === 3 && holes.length === 0) {
      this.tri(points[0] as Vec3, points[1] as Vec3, points[2] as Vec3, colour);
      return;
    }
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i] as Vec3;
      const q = points[(i + 1) % n] as Vec3;
      nx += (p[1] - q[1]) * (p[2] + q[2]);
      ny += (p[2] - q[2]) * (p[0] + q[0]);
      nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    nx /= l;
    ny /= l;
    nz /= l;
    // Basis (u, v) in the plane with u × v = n, so 2D winding matches 3D winding.
    let ux: number;
    let uy: number;
    let uz: number;
    if (Math.abs(ny) > 0.9) {
      ux = 1;
      uy = 0;
      uz = 0;
    } else {
      ux = 0;
      uy = 1;
      uz = 0;
    }
    const d = ux * nx + uy * ny + uz * nz;
    ux -= nx * d;
    uy -= ny * d;
    uz -= nz * d;
    const ul = Math.hypot(ux, uy, uz);
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    const all: Vec3[] = [...points];
    const holeStarts: number[] = [];
    for (const h of holes) {
      holeStarts.push(all.length);
      for (const p of h) all.push(p);
    }
    const flat = new Array<number>(all.length * 2);
    for (let i = 0; i < all.length; i++) {
      const p = all[i] as Vec3;
      flat[i * 2] = p[0] * ux + p[1] * uy + p[2] * uz;
      flat[i * 2 + 1] = p[0] * vx + p[1] * vy + p[2] * vz;
    }
    const tris = earcut(flat, holeStarts, 2);
    this.reserve(all.length, tris.length);
    const base = this.vertexCount;
    for (const p of all) this.push(p, nx, ny, nz, colour);
    for (let i = 0; i < tris.length; i++) this.indices[this.indexCount++] = base + (tris[i] as number);
  }

  finish(): BuildingMesh {
    const positions = this.positions.slice(0, this.vertexCount * 3);
    const min: [number, number, number] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const max: [number, number, number] = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = positions[i + k] as number;
        if (v < (min[k] as number)) min[k] = v;
        if (v > (max[k] as number)) max[k] = v;
      }
    }
    if (this.vertexCount === 0) {
      min.fill(0);
      max.fill(0);
    }
    return {
      positions,
      normals: this.normals.slice(0, this.vertexCount * 3),
      colors: this.colors.slice(0, this.vertexCount * 3),
      indices: this.indices.slice(0, this.indexCount),
      bounds: { min, max },
    };
  }
}
