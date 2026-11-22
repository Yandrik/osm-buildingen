/**
 * Flat geometry on the ground: road strips with round joins, and outlines.
 * Input frame (x east, y north) is mapped to three as (x, height, -y).
 */
import type { Vec2 } from '@osm-buildingen/core';
import { BufferAttribute, BufferGeometry } from 'three';

export type Rgb = readonly [number, number, number];

export interface Strip {
  line: readonly Vec2[];
  width: number;
  colour: Rgb;
  /** Height above the ground. */
  y: number;
}

const JOIN_SEGMENTS = 8;

/** One geometry with vertex colours (0..255, normalised) for many strips. */
export function stripGeometry(strips: readonly Strip[]): BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  const vertex = (x: number, y: number, h: number, c: Rgb): number => {
    positions.push(x, h, -y);
    colours.push(c[0], c[1], c[2]);
    return positions.length / 3 - 1;
  };
  for (const s of strips) {
    const half = s.width / 2;
    for (let k = 0; k + 1 < s.line.length; k++) {
      const [ax, ay] = s.line[k] as Vec2;
      const [bx, by] = s.line[k + 1] as Vec2;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const nx = (-(by - ay) / len) * half;
      const ny = ((bx - ax) / len) * half;
      const a = vertex(ax + nx, ay + ny, s.y, s.colour);
      const b = vertex(ax - nx, ay - ny, s.y, s.colour);
      const c = vertex(bx - nx, by - ny, s.y, s.colour);
      const d = vertex(bx + nx, by + ny, s.y, s.colour);
      // Counter-clockwise seen from above (+Y) after the y -> -z flip.
      index.push(a, b, c, a, c, d);
    }
    // Round joins and caps hide the gaps between segments of different direction.
    if (half >= 0.5) {
      for (const [px, py] of s.line) {
        const centre = vertex(px, py, s.y, s.colour);
        const first = positions.length / 3;
        for (let k = 0; k < JOIN_SEGMENTS; k++) {
          const t = (k / JOIN_SEGMENTS) * Math.PI * 2;
          vertex(px + Math.cos(t) * half, py + Math.sin(t) * half, s.y, s.colour);
        }
        for (let k = 0; k < JOIN_SEGMENTS; k++) {
          index.push(centre, first + k, first + ((k + 1) % JOIN_SEGMENTS));
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(normalsUp(positions.length / 3), 3));
  geometry.setAttribute('color', new BufferAttribute(new Uint8Array(colours), 3, true));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

function normalsUp(count: number): Float32Array {
  const n = new Float32Array(count * 3);
  for (let k = 0; k < count; k++) n[k * 3 + 1] = 1;
  return n;
}

/** Line-segment positions for closed rings at height `y` (for `LineSegments`). */
export function ringSegments(rings: readonly (readonly Vec2[])[], y: number): Float32Array {
  const out: number[] = [];
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const [ax, ay] = ring[k] as Vec2;
      const [bx, by] = ring[(k + 1) % ring.length] as Vec2;
      out.push(ax, y, -ay, bx, y, -by);
    }
  }
  return new Float32Array(out);
}

export function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] as string, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
