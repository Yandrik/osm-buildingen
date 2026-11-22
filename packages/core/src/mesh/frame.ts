import type { Colour } from '../colour';
import type { Vec3 } from '../types';
import type { MeshBuilder } from './builder';

/**
 * A rectangle on a wall plane with its own axes. Pieces draw in (u, v, d):
 * u along the wall to the right (seen from outside), v up, d out of the wall.
 */
export interface Frame {
  origin: Vec3;
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  width: number;
  height: number;
}

export function at(f: Frame, u: number, v: number, d = 0): Vec3 {
  return [
    f.origin[0] + f.right[0] * u + f.up[0] * v + f.normal[0] * d,
    f.origin[1] + f.right[1] * u + f.up[1] * v + f.normal[1] * d,
    f.origin[2] + f.right[2] * u + f.up[2] * v + f.normal[2] * d,
  ];
}

/** Sub-rectangle of a frame, optionally moved out of the wall by `d`. */
export function subFrame(f: Frame, u0: number, v0: number, u1: number, v1: number, d = 0): Frame {
  return { ...f, origin: at(f, u0, v0, d), width: u1 - u0, height: v1 - v0 };
}

/** Rectangle on the frame plane (facing outward). */
export function rect(
  mb: MeshBuilder,
  f: Frame,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  colour: Colour,
  d = 0,
): void {
  if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
  mb.quad(at(f, u0, v0, d), at(f, u1, v0, d), at(f, u1, v1, d), at(f, u0, v1, d), colour);
}

export interface BoxFaces {
  front?: boolean;
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
  back?: boolean;
}

/**
 * Box between depths d0 < d1 over the rectangle (u0..u1, v0..v1).
 * By default draws everything except the back face.
 */
export function box(
  mb: MeshBuilder,
  f: Frame,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  d0: number,
  d1: number,
  colour: Colour,
  faces: BoxFaces = {},
  sideColour: Colour = colour,
): void {
  if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4 || d1 - d0 < 1e-4) return;
  if (faces.front !== false)
    mb.quad(at(f, u0, v0, d1), at(f, u1, v0, d1), at(f, u1, v1, d1), at(f, u0, v1, d1), colour);
  if (faces.left !== false)
    mb.quad(at(f, u0, v0, d0), at(f, u0, v0, d1), at(f, u0, v1, d1), at(f, u0, v1, d0), sideColour);
  if (faces.right !== false)
    mb.quad(at(f, u1, v0, d1), at(f, u1, v0, d0), at(f, u1, v1, d0), at(f, u1, v1, d1), sideColour);
  if (faces.top !== false)
    mb.quad(at(f, u0, v1, d1), at(f, u1, v1, d1), at(f, u1, v1, d0), at(f, u0, v1, d0), sideColour);
  if (faces.bottom !== false)
    mb.quad(at(f, u0, v0, d0), at(f, u1, v0, d0), at(f, u1, v0, d1), at(f, u0, v0, d1), sideColour);
  if (faces.back === true)
    mb.quad(at(f, u1, v0, d0), at(f, u0, v0, d0), at(f, u0, v1, d0), at(f, u1, v1, d0), colour);
}

/**
 * Rectangular recess: the four reveal faces from the wall plane (d = 0) back to
 * d = -depth, and a back face. Returns nothing; the caller draws the wall around it.
 */
export function recess(
  mb: MeshBuilder,
  f: Frame,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  depth: number,
  revealColour: Colour,
  backColour: Colour,
): void {
  const d = -depth;
  mb.quad(at(f, u0, v0, 0), at(f, u0, v0, d), at(f, u0, v1, d), at(f, u0, v1, 0), revealColour); // left reveal faces right
  mb.quad(at(f, u1, v0, d), at(f, u1, v0, 0), at(f, u1, v1, 0), at(f, u1, v1, d), revealColour); // right
  mb.quad(at(f, u0, v1, d), at(f, u1, v1, d), at(f, u1, v1, 0), at(f, u0, v1, 0), revealColour); // top faces down
  mb.quad(at(f, u0, v0, 0), at(f, u1, v0, 0), at(f, u1, v0, d), at(f, u0, v0, d), revealColour); // sill faces up
  rect(mb, f, u0, v0, u1, v1, backColour, d);
}
