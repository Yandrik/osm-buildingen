import { timberFrame, wallRect } from './common';
import type { Piece } from './types';

/** Plain wall cell. */
export const wall: Piece = (mb, f, ctx) => {
  wallRect(mb, f, ctx, 0, 0, f.width, f.height);
  if (ctx.timber) timberFrame(mb, f, ctx, null);
};
