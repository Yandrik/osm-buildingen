/**
 * Dev tool: renders building meshes to a PNG with a small software rasteriser.
 * No GPU or browser needed, so it works in CI and for quick visual checks.
 *
 *   pnpm exec tsx tools/render.ts out.png            # built-in sample sheet
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { BuildingMesh } from '../packages/core/src';

export interface Placed {
  mesh: BuildingMesh;
  /** Offset in output space (x east, z south). */
  x: number;
  z: number;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  /** Camera direction: azimuth (degrees, 0 = looking north) and elevation above the horizon. */
  azimuth?: number;
  elevation?: number;
  background?: [number, number, number];
  ground?: [number, number, number];
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] as number;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function png(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Orthographic render with a z-buffer, flat lighting and 2x supersampling. */
export function render(items: Placed[], options: RenderOptions = {}): Buffer {
  const outW = options.width ?? 1400;
  const outH = options.height ?? 900;
  const ss = 2;
  const W = outW * ss;
  const H = outH * ss;
  const az = ((options.azimuth ?? 30) * Math.PI) / 180;
  const el = ((options.elevation ?? 30) * Math.PI) / 180;
  // Camera basis. View direction points from the camera into the scene.
  const dir = [Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el)];
  const right = [Math.cos(az), 0, Math.sin(az)];
  const up = [
    right[1]! * dir[2]! - right[2]! * dir[1]!,
    right[2]! * dir[0]! - right[0]! * dir[2]!,
    right[0]! * dir[1]! - right[1]! * dir[0]!,
  ];
  const light = [-0.45, 0.8, 0.4];
  const ll = Math.hypot(light[0]!, light[1]!, light[2]!);

  // Project everything once to find the extent.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const proj = (x: number, y: number, z: number): [number, number, number] => [
    x * right[0]! + y * right[1]! + z * right[2]!,
    x * up[0]! + y * up[1]! + z * up[2]!,
    x * dir[0]! + y * dir[1]! + z * dir[2]!,
  ];
  for (const { mesh, x, z } of items) {
    for (const cx of [mesh.bounds.min[0], mesh.bounds.max[0]])
      for (const cy of [0, mesh.bounds.max[1]])
        for (const cz of [mesh.bounds.min[2], mesh.bounds.max[2]]) {
          const p = proj(cx + x, cy, cz + z);
          minX = Math.min(minX, p[0]);
          maxX = Math.max(maxX, p[0]);
          minY = Math.min(minY, p[1]);
          maxY = Math.max(maxY, p[1]);
        }
  }
  const pad = 2;
  const scale = Math.min(W / (maxX - minX + 2 * pad), H / (maxY - minY + 2 * pad));
  const ox = W / 2 - ((minX + maxX) / 2) * scale;
  const oy = H / 2 + ((minY + maxY) / 2) * scale;

  const bg = options.background ?? [226, 232, 238];
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    img[i * 3] = bg[0];
    img[i * 3 + 1] = bg[1];
    img[i * 3 + 2] = bg[2];
  }
  const depth = new Float32Array(W * H).fill(Number.POSITIVE_INFINITY);

  const tri = (a: number[], b: number[], c: number[], col: number[]): void => {
    const x0 = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!)));
    const y0 = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!)));
    const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
    if (Math.abs(area) < 1e-9) return;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((b[0]! - px) * (c[1]! - py) - (b[1]! - py) * (c[0]! - px)) / area;
        const w1 = ((c[0]! - px) * (a[1]! - py) - (c[1]! - py) * (a[0]! - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2]! + w1 * b[2]! + w2 * c[2]!;
        const i = y * W + x;
        if (z < depth[i]!) {
          depth[i] = z;
          img[i * 3] = col[0]!;
          img[i * 3 + 1] = col[1]!;
          img[i * 3 + 2] = col[2]!;
        }
      }
    }
  };
  const screen = (x: number, y: number, z: number): number[] => {
    const p = proj(x, y, z);
    return [ox + p[0] * scale, oy - p[1] * scale, p[2]];
  };

  // Ground slab under each building.
  const g = options.ground ?? [150, 190, 120];
  for (const { mesh, x, z } of items) {
    const m = 3;
    const a = screen(mesh.bounds.min[0] + x - m, 0, mesh.bounds.min[2] + z - m);
    const b = screen(mesh.bounds.max[0] + x + m, 0, mesh.bounds.min[2] + z - m);
    const c = screen(mesh.bounds.max[0] + x + m, 0, mesh.bounds.max[2] + z + m);
    const d = screen(mesh.bounds.min[0] + x - m, 0, mesh.bounds.max[2] + z + m);
    for (const p of [a, b, c, d]) p[2] = p[2]! + 0.05;
    tri(a, b, c, g);
    tri(a, c, d, g);
  }

  for (const { mesh, x, z } of items) {
    const { positions: P, normals: N, colors: C, indices: I } = mesh;
    for (let t = 0; t < I.length; t += 3) {
      const ia = I[t]! * 3;
      const ib = I[t + 1]! * 3;
      const ic = I[t + 2]! * 3;
      const nx = N[ia]!;
      const ny = N[ia + 1]!;
      const nz = N[ia + 2]!;
      if (nx * dir[0]! + ny * dir[1]! + nz * dir[2]! > 0) continue; // back face
      const lambert = Math.max(0, (nx * light[0]! + ny * light[1]! + nz * light[2]!) / ll);
      const k = 0.72 + 0.38 * lambert;
      const col = [Math.min(255, C[ia]! * k), Math.min(255, C[ia + 1]! * k), Math.min(255, C[ia + 2]! * k)];
      tri(
        screen(P[ia]! + x, P[ia + 1]!, P[ia + 2]! + z),
        screen(P[ib]! + x, P[ib + 1]!, P[ib + 2]! + z),
        screen(P[ic]! + x, P[ic + 1]!, P[ic + 2]! + z),
        col,
      );
    }
  }

  const out = new Uint8Array(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = 0; dy < ss; dy++)
          for (let dx = 0; dx < ss; dx++) s += img[((y * ss + dy) * W + x * ss + dx) * 3 + k]!;
        out[(y * outW + x) * 3 + k] = Math.round(s / (ss * ss));
      }
    }
  }
  return png(outW, outH, out);
}

/** Lays meshes out on a grid, left to right, back to front. */
export function grid(meshes: BuildingMesh[], columns: number, spacing: number): Placed[] {
  return meshes.map((mesh, i) => {
    const cx = (mesh.bounds.min[0] + mesh.bounds.max[0]) / 2;
    const cz = (mesh.bounds.min[2] + mesh.bounds.max[2]) / 2;
    return { mesh, x: (i % columns) * spacing - cx, z: Math.floor(i / columns) * spacing - cz };
  });
}

export function save(path: string, items: Placed[], options?: RenderOptions): void {
  writeFileSync(path, render(items, options));
}
