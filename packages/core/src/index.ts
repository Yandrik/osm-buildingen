import { dePack } from './styles/de';
import { registerStylePack } from './styles/registry';
import { usPack } from './styles/us';

// Built-in packs.
registerStylePack(dePack);
registerStylePack(usPack);

export { generateBuilding, resolveBuilding } from './generate';
export { GENERATOR_VERSION } from './version';
export { registerStylePack, getStylePack, listStylePacks, validateStylePack } from './styles/registry';
export { evalCurve } from './styles/types';
export type {
  BalconyLayout,
  BalconyStyle,
  Curve,
  FacadeTile,
  PaletteSet,
  RailingKind,
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
