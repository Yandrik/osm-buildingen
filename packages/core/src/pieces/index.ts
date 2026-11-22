import { balcony } from './balcony';
import { door, garageDoor } from './door';
import { shopfront } from './shopfront';
import type { Piece } from './types';
import { wall } from './wall';
import { window } from './window';

export type { Piece, PieceContext } from './types';

/** Pieces by the name style packs use in `FacadeTile.piece`. */
export const PIECES: Readonly<Record<string, Piece>> = {
  wall,
  window,
  door,
  garageDoor,
  shopfront,
  balcony,
};
