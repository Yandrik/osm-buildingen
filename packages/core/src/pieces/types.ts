import type { Colour } from '../colour';
import type { MeshBuilder } from '../mesh/builder';
import type { Frame } from '../mesh/frame';
import type { Palette } from '../types';

export interface PieceContext {
  params: Readonly<Record<string, number>>;
  palette: Palette;
  /** Wall colour for this cell (may differ from palette.wall on timber infill). */
  wall: Colour;
  /** Height of the plinth band inside this cell (0 above the ground row). */
  plinth: number;
  /** Draw timber framing over the wall parts of the cell. */
  timber: boolean;
  /** 0 = old .. 1 = new; pieces may simplify details for modern buildings. */
  era: number;
  /** Seed for small per-cell variation (brace direction and the like). */
  seed: number;
}

/** Draws one facade cell, including the wall around its opening. */
export type Piece = (mb: MeshBuilder, frame: Frame, ctx: PieceContext) => void;
