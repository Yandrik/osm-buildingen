import { dePack } from './styles/de';
import { registerStylePack } from './styles/registry';

// Built-in packs. 'us' is served by the German pack until its own pack lands (milestone 5).
registerStylePack(dePack);
registerStylePack({ ...dePack, id: 'us' });

export { generateBuilding, resolveBuilding } from './generate';
export { GENERATOR_VERSION } from './version';
export { registerStylePack, getStylePack, listStylePacks, validateStylePack } from './styles/registry';
export { evalCurve } from './styles/types';
export type {
  Curve,
  FacadeTile,
  PaletteSet,
  RowKind,
  SocketTable,
  StylePack,
  TileRole,
  TypeStyle,
  Weighted,
} from './styles/types';
export { Rng, hashString, seedFrom } from './rng';
export { parseColour } from './colour';
export type { Colour } from './colour';
export * from './types';
