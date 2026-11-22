import type { BuildingType } from '../types';
import type {
  Curve,
  FacadeTile,
  PaletteSet,
  RoofDetailStyle,
  RowKind,
  SocketTable,
  StylePack,
  TileRole,
  TypeStyle,
} from './types';

/**
 * German style pack. See plan/styles/de-residential.md and non-residential.md.
 *
 * Reading guide: a curve like [[0, 8], [1, 3]] means "8 for old buildings, 3 for
 * new ones, blended in between". Tiles with a `variant` only appear on buildings
 * that rolled that variant, so one building never mixes window styles.
 */

export const ALL: readonly RowKind[] = ['ground', 'upper', 'top'];
export const UP: readonly RowKind[] = ['upper', 'top'];
export const GROUND: readonly RowKind[] = ['ground'];

export interface TileOptions {
  rows?: readonly RowKind[];
  params?: Record<string, number>;
  weight?: Curve;
  variant?: string;
  h?: string;
  up?: string;
  down?: string;
  minWidth?: number;
  blockedOk?: boolean;
}

export function tile(id: string, piece: string, role: TileRole, o: TileOptions = {}): FacadeTile {
  // Ground-floor openings accept anything above them; windows want windows above.
  const opening =
    role === 'door' || role === 'garage' || role === 'dock' || role === 'shop' || role === 'shopdoor';
  const v = role === 'blank' ? 'solid' : opening ? 'door' : 'win';
  return {
    id,
    piece,
    role,
    rows: o.rows ?? ALL,
    params: o.params,
    left: o.h ?? 'w',
    right: o.h ?? 'w',
    up: o.up ?? v,
    down: o.down ?? (v === 'door' ? 'solid' : v),
    weight: o.weight ?? 1,
    variant: o.variant,
    minWidth: o.minWidth,
    blockedOk: o.blockedOk ?? role === 'blank',
  };
}

/** Windows stack on windows; anything may sit on plain wall or above a door. */
export const STACKING: SocketTable = {
  h: { w: ['w'] },
  v: { solid: ['solid', 'win'], win: ['win'], door: ['solid', 'win'] },
};

/** Like STACKING, but plain wall may also sit above a window (looser, for sheds and halls). */
export const LOOSE: SocketTable = {
  h: { w: ['w'] },
  v: { solid: ['solid', 'win'], win: ['win', 'solid'], door: ['solid', 'win'] },
};

const palette: PaletteSet = {
  wall: [
    ['#f2efe6', [[0, 3], [1, 5]]],
    ['#efe6cf', [[0, 3], [1, 1]]],
    ['#e9d9a6', [[0, 2], [1, 0.4]]],
    ['#e3c98a', [[0, 1.5], [1, 0.2]]],
    ['#e6b8a0', [[0, 1], [0.6, 1], [1, 0.2]]],
    ['#d9d9d4', [[0, 1], [1, 3]]],
    ['#cfdcc0', [[0, 0.8], [1, 0.3]]],
    ['#c9d6e0', [[0, 0.6], [1, 0.4]]],
    ['#d8c9a8', [[0, 1.2], [1, 0.6]]],
    ['#55595e', [[0.7, 0], [1, 1.2]]],
  ],
  roof: [
    ['#b5452f', 3],
    ['#8f3b2a', 2.5],
    ['#c9623a', 1.2],
    ['#5e3a2c', 1],
    ['#3f4347', [[0, 0.6], [1, 3]]],
    ['#5b6068', 0.8],
  ],
  roofFlat: [
    ['#9a9a94', 3],
    ['#6a6d70', 2],
    ['#7d9a6a', [[0.6, 0], [1, 1]]],
  ],
  trim: [
    ['#f5f5f0', 5],
    ['#d8d8d2', 2],
    ['#8a6a4a', [[0, 1.5], [0.6, 0]]],
    ['#3d4145', [[0.6, 0], [1, 2]]],
  ],
  door: [
    ['#7a4a2a', 3],
    ['#a8743e', 2],
    ['#3f5d48', 1.5],
    ['#7a2e2a', 1.2],
    ['#3a5a80', 1],
    ['#eeeeea', [[0.3, 0.5], [1, 2]]],
    ['#3d4145', [[0.5, 0], [1, 3]]],
  ],
  accent: [['#b5452f', 1], ['#3a5a80', 1], ['#3f5d48', 1], ['#d9a441', 1], ['#3d4145', 1]],
  timber: [['#4a3426', 3], ['#6e2b22', 1.5], ['#33261e', 1.5]],
  glass: '#a8cfdf',
  frame: [
    ['#f5f5f0', [[0, 3], [1, 2]]],
    ['#6a4a32', [[0, 2], [0.5, 0.5], [1, 0]]],
    ['#3d4145', [[0.5, 0], [1, 3]]],
  ],
};

// --- Residential -----------------------------------------------------------

/**
 * Window variants shared by house, apartments and townhouse.
 * `framed`: old, upright, with mullions (and shutters on some).
 * `plain`: post-war, wider, no trim.
 * `modern`: large glass, floor-to-ceiling on upper levels.
 */
const residentialWindows: FacadeTile[] = [
  tile('win_framed', 'window', 'window', {
    variant: 'framed',
    weight: 4,
    params: { w: 0.4, h: 0.5, sill: 0.3, frame: 1, mullionV: 1, mullionH: 1, sillBox: 1 },
  }),
  tile('win_framed_shutters', 'window', 'window', {
    variant: 'shutters',
    weight: 4,
    params: { w: 0.36, h: 0.5, sill: 0.3, frame: 1, mullionV: 1, mullionH: 1, sillBox: 1, shutters: 1 },
  }),
  tile('win_plain', 'window', 'window', {
    variant: 'plain',
    weight: 4,
    params: { w: 0.5, h: 0.45, sill: 0.33, frame: 0, mullionV: 1, sillBox: 1 },
  }),
  tile('win_plain_wide', 'window', 'window', {
    variant: 'plain',
    weight: 1,
    minWidth: 2.8,
    params: { w: 0.72, h: 0.45, sill: 0.33, frame: 0, mullionV: 2, sillBox: 1 },
  }),
  tile('win_modern', 'window', 'window', {
    variant: 'modern',
    weight: 3,
    params: { w: 0.5, h: 0.55, sill: 0.3, frame: 0 },
  }),
  tile('win_modern_floor', 'window', 'window', {
    variant: 'modern',
    weight: 2,
    params: { w: 0.62, h: 0.8, sill: 0.05, frame: 0, mullionV: 1 },
  }),
  tile('win_modern_slit', 'window', 'window', {
    variant: 'modern',
    weight: 0.6,
    params: { w: 0.18, h: 0.7, sill: 0.15, frame: 0 },
  }),
];

const house: TypeStyle = {
  levelHeight: [[0, 2.7], [0.25, 3.05], [0.5, 2.75], [1, 2.9]],
  groundExtra: 0,
  levels: [
    [1, [[0, 1], [0.5, 2], [1, 1]]],
    [2, 6],
    [3, [[0, 1.5], [0.5, 0.5], [1, 0.8]]],
  ],
  roofShapes: [
    ['gabled', [[0, 8.5], [0.5, 7.5], [0.8, 5], [1, 3]]],
    ['half-hipped', [[0, 1], [0.5, 0.5], [1, 0]]],
    ['hipped', [[0, 0.5], [0.5, 1.5], [1, 0.5]]],
    ['flat', [[0.45, 0], [0.6, 1], [1, 4.5]]],
    ['skillion', [[0.6, 0], [1, 2]]],
  ],
  roofPitch: [[0, 48], [0.5, 38], [0.8, 32], [1, 25]],
  roofPitchSpread: 5,
  overhang: [[0, 0.35], [0.8, 0.4], [1, 0.25]],
  parapet: [[0, 0.2], [1, 0.45]],
  bayWidth: [[0, 2.6], [1, 3.2]],
  plinth: [[0, 0.5], [0.6, 0.35], [1, 0.15]],
  wallStyles: [
    ['plain', 1],
    ['timber', [[0, 1.6], [0.18, 0.5], [0.32, 0]]],
  ],
  variants: [
    ['framed', [[0, 2], [0.4, 1.5], [0.6, 0]]],
    ['shutters', [[0, 2], [0.35, 1], [0.55, 0]]],
    ['plain', [[0.3, 0], [0.5, 3], [0.8, 2], [1, 0.3]]],
    ['modern', [[0.7, 0], [0.85, 2], [1, 4]]],
  ],
  tiles: [
    tile('blank', 'wall', 'blank', {
      weight: [[0, 1.3], [1, 1]],
    }),
    ...residentialWindows,
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 1.05, h: 2.1, canopy: 1, step: 1, glass: 0.35 },
    }),
    tile('balcony', 'balcony', 'balcony', {
      rows: UP,
      weight: [[0.4, 0], [0.6, 0.5], [1, 0.8]],
      minWidth: 2.4,
      params: { depth: 1.1 },
    }),
  ],
  sockets: STACKING,
  symmetry: [[0, 0.6], [0.5, 0.4], [1, 0.25]],
};

const apartments: TypeStyle = {
  ...house,
  levelHeight: [[0, 2.9], [0.25, 3.4], [0.5, 2.8], [1, 2.95]],
  levels: [
    [3, 3],
    [4, 4],
    [5, 2.5],
    [6, [[0, 0.3], [0.5, 1.5], [1, 1]]],
  ],
  roofShapes: [
    ['gabled', [[0, 6], [0.5, 4], [1, 1]]],
    ['hipped', [[0, 2], [0.5, 2], [1, 0.5]]],
    ['half-hipped', [[0, 1], [0.5, 0.3], [1, 0]]],
    ['flat', [[0.3, 0], [0.5, 4], [1, 7]]],
  ],
  roofPitch: [[0, 42], [0.5, 30], [1, 22]],
  bayWidth: [[0, 2.7], [1, 3.3]],
  wallStyles: [['plain', 1]],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 0.6 }),
    ...residentialWindows,
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 1.3, h: 2.2, canopy: 1, step: 1, glass: 0.6 },
    }),
    tile('balcony', 'balcony', 'balcony', {
      rows: UP,
      weight: [[0.2, 0], [0.4, 1], [1, 2.2]],
      minWidth: 2.4,
      params: { depth: 1.3 },
    }),
    tile('shopfront', 'shopfront', 'shop', { rows: GROUND, params: { base: 0.4 }, h: 'w' }),
    tile('shopdoor', 'shopfront', 'shopdoor', { rows: GROUND, params: { base: 0.4, door: 1 } }),
  ],
  symmetry: [[0, 0.7], [1, 0.5]],
};

const townhouse: TypeStyle = {
  ...apartments,
  levelHeight: [[0, 2.9], [0.25, 3.5], [0.6, 2.9], [1, 3.0]],
  groundExtra: [[0, 0.3], [0.25, 0.6], [1, 0.4]],
  levels: [[2, 1], [3, 4], [4, 4], [5, 1.5]],
  roofShapes: [
    ['gabled', [[0, 8], [0.5, 5], [1, 2]]],
    ['flat', [[0.3, 0], [0.5, 2], [1, 6]]],
    ['hipped', 0.5],
  ],
  roofPitch: [[0, 50], [0.5, 38], [1, 28]],
  bayWidth: [[0, 2.3], [1, 3.0]],
  wallStyles: [
    ['plain', 1],
    ['timber', [[0, 1.2], [0.15, 0.4], [0.3, 0]]],
  ],
};

const garage: TypeStyle = {
  levelHeight: 2.5,
  groundExtra: 0,
  levels: [[1, 1]],
  roofShapes: [
    ['flat', 8],
    ['gabled', [[0, 2.5], [1, 1]]],
    ['skillion', 0.6],
  ],
  roofPitch: [[0, 32], [1, 22]],
  roofPitchSpread: 4,
  overhang: 0.15,
  parapet: 0.12,
  bayWidth: 2.9,
  plinth: 0.12,
  wallStyles: [['plain', 1]],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 6 }),
    tile('win_small', 'window', 'window', { weight: 0.5, params: { w: 0.3, h: 0.25, sill: 0.55, frame: 0 } }),
    tile('garage_door', 'garageDoor', 'garage', { rows: GROUND, params: { w: 0.84, h: 2.1, lines: 4 } }),
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 0.9, h: 2.0, glass: 0 } }),
  ],
  sockets: LOOSE,
  symmetry: 0,
  inheritsGroupWall: true,
};

const shed: TypeStyle = {
  ...garage,
  levelHeight: 2.2,
  roofShapes: [['gabled', 4], ['skillion', 4], ['flat', 2]],
  roofPitch: 20,
  overhang: 0.2,
  bayWidth: 2.2,
  plinth: 0,
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 6 }),
    tile('win_small', 'window', 'window', { weight: 0.7, params: { w: 0.35, h: 0.3, sill: 0.45, frame: 1 } }),
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 0.85, h: 1.9, glass: 0 } }),
  ],
  palette: {
    wall: [['#8a6a48', 3], ['#6f5a44', 2], ['#9a8a70', 1.5], ['#5f6a5a', 1], ['#7d8388', 1]],
    roof: [['#4a4d50', 3], ['#5e3a2c', 1], ['#6a7a5a', 1]],
  },
  inheritsGroupWall: false,
};

// --- Non-residential -------------------------------------------------------

const office: TypeStyle = {
  levelHeight: [[0, 3.6], [0.5, 3.3], [1, 3.6]],
  groundExtra: [[0, 0.8], [1, 1.0]],
  levels: [[3, 2], [4, 3], [5, 3], [6, 2], [8, 1]],
  roofShapes: [
    ['flat', [[0, 3], [0.4, 8], [1, 10]]],
    ['hipped', [[0, 4], [0.4, 1], [1, 0]]],
    ['gabled', [[0, 1.5], [0.5, 0.3], [1, 0]]],
  ],
  roofPitch: [[0, 35], [1, 20]],
  roofPitchSpread: 4,
  overhang: [[0, 0.3], [0.5, 0.1], [1, 0]],
  parapet: [[0, 0.5], [1, 0.9]],
  bayWidth: [[0, 3.0], [0.5, 3.2], [1, 3.6]],
  plinth: [[0, 0.7], [1, 0.2]],
  wallStyles: [['plain', 1]],
  variants: [
    ['punched', [[0, 4], [0.4, 2], [0.7, 0.3], [1, 0]]],
    ['band', [[0.3, 0], [0.5, 4], [0.8, 1.5], [1, 0.5]]],
    ['curtain', [[0.6, 0], [0.8, 2], [1, 5]]],
  ],
  tiles: [
    tile('blank', 'wall', 'blank', {
      weight: [[0, 1], [1, 0.3]],
    }),
    // Old: small upright windows, much wall between them.
    tile('win_punched', 'window', 'window', {
      variant: 'punched',
      weight: 6,
      params: { w: 0.34, h: 0.55, sill: 0.25, frame: 1, mullionH: 1, sillBox: 1 },
    }),
    // Post-war: ribbon windows that run through; a band may only end at a corner.
    tile('win_band', 'window', 'window', {
      variant: 'band',
      weight: 8,
      h: 'band',
      params: { w: 1, h: 0.45, sill: 0.3, frame: 0, mullionV: 2 },
    }),
    // New: glass from slab to slab.
    tile('curtain', 'window', 'window', {
      variant: 'curtain',
      weight: 10,
      h: 'band',
      params: { w: 1, h: 0.9, sill: 0.05, frame: 0, mullionV: 1, mullionH: 1 },
    }),
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 1.9, h: 2.4, canopy: 1, glass: 0.85, double: 1 },
    }),
    tile('lobby', 'shopfront', 'shop', { rows: GROUND, weight: 3, params: { base: 0.25 } }),
  ],
  sockets: {
    h: { w: ['w', 'band'], band: ['band', 'w'] },
    v: { solid: ['solid', 'win'], win: ['win'], door: ['solid', 'win'] },
  },
  symmetry: [[0, 0.8], [1, 0.4]],
  palette: {
    wall: [
      ['#d8cfc0', [[0, 3], [1, 1]]],
      ['#b9a58c', [[0, 2], [1, 0.3]]],
      ['#a8573f', [[0, 1.5], [1, 0.2]]],
      ['#c9c9c4', [[0, 1], [0.5, 4], [1, 2]]],
      ['#e9e9e4', [[0.4, 1], [1, 4]]],
      ['#6a6f76', [[0.5, 0], [1, 3]]],
      ['#3f454d', [[0.7, 0], [1, 2]]],
    ],
  },
};

const skyscraper: TypeStyle = {
  ...office,
  levelHeight: 3.7,
  groundExtra: 1.8,
  levels: [[18, 2], [24, 3], [30, 2], [40, 1]],
  roofShapes: [['flat', 1]],
  parapet: 1.2,
  bayWidth: [[0, 2.8], [1, 3.2]],
  variants: [
    ['punched', [[0, 3], [0.5, 0.5], [1, 0]]],
    ['band', [[0.3, 0], [0.5, 3], [1, 0.5]]],
    ['curtain', [[0.5, 0], [0.7, 3], [1, 6]]],
  ],
  symmetry: 0.9,
};

const industrial: TypeStyle = {
  levelHeight: [[0, 6], [1, 8]],
  groundExtra: 0,
  levels: [[1, 1]],
  roofShapes: [
    ['flat', [[0, 2], [1, 6]]],
    ['gabled', [[0, 5], [1, 2.5]]],
    ['skillion', 0.8],
  ],
  roofPitch: [[0, 22], [1, 10]],
  roofPitchSpread: 3,
  overhang: 0.1,
  parapet: 0.3,
  bayWidth: [[0, 4.5], [1, 6]],
  plinth: 0.8,
  wallStyles: [['metal', 1]],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 5 }),
    tile('win_strip', 'window', 'window', {
      weight: 2,
      params: { w: 0.8, h: 0.14, sill: 0.72, frame: 0, mullionV: 3 },
    }),
    tile('dock', 'garageDoor', 'dock', { rows: GROUND, params: { w: 0.7, h: 4.2, lines: 7 } }),
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 1.0, h: 2.1, glass: 0, canopy: 1 } }),
  ],
  sockets: LOOSE,
  symmetry: 0,
  palette: {
    wall: [
      ['#b8bcc0', 4],
      ['#d5d5d0', 3],
      ['#7f8a94', 2],
      ['#5d7a96', 1.2],
      ['#6f8f7a', 1],
      ['#a8573f', [[0, 3], [0.5, 0.5], [1, 0]]],
      ['#c9b48a', 0.8],
    ],
    roof: [
      ['#6a6d70', 3],
      ['#8a8d90', 2],
      ['#8f3b2a', [[0, 1.5], [1, 0]]],
    ],
    door: [['#5a6067', 3], ['#3a5a80', 1], ['#9a2f2a', 1], ['#d9a441', 0.6]],
  },
};

const station: TypeStyle = {
  levelHeight: [[0, 4.2], [1, 3.8]],
  groundExtra: 0,
  levels: [
    [1, 3],
    [2, [[0, 3], [1, 0.5]]],
  ],
  roofShapes: [
    ['hipped', [[0, 4], [0.5, 1], [1, 0]]],
    ['gabled', [[0, 3], [0.5, 1], [1, 0.3]]],
    ['flat', [[0, 0.3], [0.5, 4], [1, 6]]],
  ],
  roofPitch: [[0, 32], [1, 15]],
  roofPitchSpread: 4,
  overhang: [[0, 0.6], [1, 1.2]],
  parapet: 0.25,
  bayWidth: [[0, 3.2], [1, 3.6]],
  plinth: [[0, 0.6], [1, 0.15]],
  wallStyles: [['plain', 1]],
  variants: [
    ['framed', [[0, 3], [0.5, 1], [0.7, 0]]],
    ['modern', [[0.4, 0], [0.6, 2], [1, 4]]],
  ],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 0.8 }),
    tile('win_tall', 'window', 'window', {
      variant: 'framed',
      weight: 4,
      params: { w: 0.42, h: 0.62, sill: 0.2, frame: 1, mullionV: 1, mullionH: 2, sillBox: 1 },
    }),
    tile('win_glass', 'window', 'window', {
      variant: 'modern',
      weight: 5,
      h: 'band',
      params: { w: 1, h: 0.85, sill: 0.05, frame: 0, mullionV: 1 },
    }),
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 2.0, h: 2.5, canopy: 1, glass: 0.8, double: 1 },
    }),
  ],
  sockets: {
    h: { w: ['w', 'band'], band: ['band', 'w'] },
    v: { solid: ['solid', 'win'], win: ['win'], door: ['solid', 'win'] },
  },
  symmetry: 0.8,
  palette: {
    wall: [
      ['#a8573f', [[0, 4], [0.6, 1], [1, 0.3]]],
      ['#d8c9a8', [[0, 3], [1, 1]]],
      ['#e9e9e4', [[0.3, 1], [1, 4]]],
      ['#c9c9c4', [[0.3, 1], [1, 2]]],
    ],
  },
};

const store: TypeStyle = {
  levelHeight: [[0, 3.6], [1, 4.2]],
  groundExtra: 0,
  levels: [[1, 4], [2, 1]],
  roofShapes: [
    ['flat', [[0, 3], [1, 9]]],
    ['gabled', [[0, 3], [1, 0.5]]],
    ['hipped', [[0, 1], [1, 0.3]]],
  ],
  roofPitch: [[0, 35], [1, 15]],
  roofPitchSpread: 4,
  overhang: 0.2,
  parapet: [[0, 0.5], [1, 1.0]],
  bayWidth: [[0, 3.0], [1, 4.0]],
  plinth: 0.2,
  wallStyles: [['plain', 1]],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 5 }),
    tile('win_small', 'window', 'window', {
      rows: UP,
      weight: 2,
      params: { w: 0.45, h: 0.4, sill: 0.35, frame: 0 },
    }),
    tile('shopfront', 'shopfront', 'shop', { rows: GROUND, params: { base: 0.35 } }),
    tile('shopdoor', 'shopfront', 'shopdoor', { rows: GROUND, params: { base: 0.35, door: 1 } }),
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 1.0, h: 2.1, glass: 0 } }),
  ],
  sockets: LOOSE,
  symmetry: 0.3,
  palette: {
    wall: [
      ['#e9e9e4', 4],
      ['#d5d5d0', 2],
      ['#efe6cf', 2],
      ['#c9623a', 0.6],
      ['#3f454d', [[0.6, 0], [1, 2]]],
    ],
  },
};

/** Roof decoration probabilities per type; see RoofDetailStyle. */
const roofDetails: Partial<Record<BuildingType, RoofDetailStyle>> = {
  house: {
    dormer: [[0, 0.25], [0.5, 0.3], [0.75, 0.55], [1, 0.2]],
    chimney: [[0, 0.9], [0.6, 0.8], [1, 0.25]],
    atticWindow: [[0, 0.7], [1, 0.5]],
  },
  apartments: {
    dormer: [[0, 0.5], [0.5, 0.4], [1, 0.3]],
    chimney: [[0, 0.9], [0.6, 0.6], [1, 0.1]],
    atticWindow: 0.5,
    clutter: [[0, 0.3], [1, 0.8]],
  },
  townhouse: {
    dormer: [[0, 0.6], [0.5, 0.4], [1, 0.3]],
    chimney: [[0, 0.9], [0.6, 0.6], [1, 0.1]],
    atticWindow: 0.6,
    clutter: [[0, 0.2], [1, 0.6]],
  },
  office: {
    dormer: [[0, 0.3], [0.5, 0]],
    chimney: [[0, 0.5], [0.5, 0]],
    clutter: 0.9,
  },
  skyscraper: { clutter: 1 },
  industrial: { clutter: 0.7 },
  station: {
    chimney: [[0, 0.6], [0.5, 0]],
    clutter: 0.4,
  },
  store: { clutter: 0.8 },
};

const withDetails = (type: BuildingType, style: TypeStyle): TypeStyle => ({
  ...style,
  roofDetails: roofDetails[type],
});

export const deTypes: Record<BuildingType, TypeStyle> = {
  house: withDetails('house', house),
  apartments: withDetails('apartments', apartments),
  townhouse: withDetails('townhouse', townhouse),
  garage,
  shed,
  office: withDetails('office', office),
  skyscraper: withDetails('skyscraper', skyscraper),
  industrial: withDetails('industrial', industrial),
  station: withDetails('station', station),
  store: withDetails('store', store),
};

export const dePack: StylePack = { id: 'de', version: 1, palette, types: deTypes };
