import type { BuildingType } from '../types';
import type {
  BalconyStyle,
  CanopyStyle,
  Curve,
  FacadeTile,
  PaletteSet,
  RoofDetailStyle,
  RowKind,
  SocketTable,
  StylePack,
  TileRole,
  TrimStyle,
  TypeStyle,
  Weighted,
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

/** Level bands and cornice on buildings from before about 1940; see TrimStyle. */
const OLD_TRIM: TrimStyle = {
  band: [[0, 0.5], [0.2, 0.85], [0.44, 0.85], [0.45, 0]],
  cornice: [[0, 0.6], [0.2, 0.95], [0.44, 0.95], [0.45, 0]],
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

/** Glazed door onto a balcony; placed by the balcony pass, never by the solver. */
export const BALCONY_DOOR: FacadeTile = tile('balcony_door', 'balconyDoor', 'balcony', { rows: UP });

export const SHOP_TILES: readonly FacadeTile[] = [
  tile('shopfront', 'shopfront', 'shop', { rows: GROUND, params: { base: 0.4 } }),
  tile('shopdoor', 'shopfront', 'shopdoor', { rows: GROUND, params: { base: 0.4, door: 1 } }),
];

/** Bar railings: mostly black and anthracite. */
export const METAL: Weighted<string> = [
  ['#26282b', 3],
  ['#3d4145', 2],
  ['#ecebe6', 1],
  ['#2f4a3a', [[0, 1], [1, 0.2]]],
];

export const WOOD: Weighted<string> = [
  ['#8a5a32', 2],
  ['#6e4a2c', 2],
  ['#a8743e', 1],
  ['#5a3c26', 1],
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
    BALCONY_DOOR,
    ...SHOP_TILES,
  ],
  sockets: STACKING,
  symmetry: [[0, 0.6], [0.5, 0.4], [1, 0.25]],
  trim: OLD_TRIM,
  balconies: {
    chance: [[0, 0.1], [0.4, 0.15]],
    railings: [
      ['solid', 1],
      ['bars', 1.5],
      ['wood', [[0, 2], [0.5, 1], [1, 0.3]]],
      ['glass', [[0.6, 0], [1, 1.5]]],
    ],
    metal: METAL,
    wood: WOOD,
    depth: [[0, 1.0], [1, 1.3]],
    layouts: [
      ['single', 4],
      ['band', [[0, 0.5], [1, 1]]],
    ],
    spans: [
      [1, 2],
      [2, 2],
      [3, 1],
    ],
    secondWall: 0.15,
  },
  // Only on request: a detached house rarely has a shop.
  shop: 0,
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
    BALCONY_DOOR,
    ...SHOP_TILES,
  ],
  symmetry: [[0, 0.7], [1, 0.5]],
  balconies: {
    chance: [[0, 0.15], [0.4, 0.25], [1, 0.4]],
    railings: [
      ['solid', 2],
      ['bars', 1.5],
      ['wood', [[0, 0.5], [1, 0.2]]],
      ['glass', [[0.6, 0], [1, 2]]],
    ],
    metal: METAL,
    wood: WOOD,
    depth: [[0, 1.1], [1, 1.5]],
    layouts: [
      ['rhythm', 4],
      ['band', [[0, 0.5], [1, 2]]],
      ['single', 0.5],
    ],
    spans: [
      [1, 3],
      [2, 2],
      [3, 0.5],
    ],
    secondWall: 0.5,
  },
  shop: [[0, 0.15], [0.6, 0.08]],
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
  balconies: { ...(apartments.balconies as BalconyStyle), chance: [[0, 0.1], [1, 0.2]] },
  shop: 0.35,
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
  trim: OLD_TRIM,
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

/**
 * Towers: podium, shaft and crown (see TowerStyle and pipeline/autoParts.ts).
 * `piers`: vertical ribs over the whole shaft, old and mid eras.
 * `podium_stone` / `podium_glass`: only on the podium, never rolled for the building.
 * `plant`: louvred plant storeys and spire bases.
 */
const skyscraper: TypeStyle = {
  ...office,
  levelHeight: 3.7,
  groundExtra: 1.8,
  levels: [[18, 2], [24, 3], [30, 2], [40, 1]],
  roofShapes: [['flat', 1]],
  parapet: [[0, 0.9], [1, 1.2]],
  bayWidth: [[0, 2.8], [1, 3.2]],
  variants: [
    ['punched', [[0, 2], [0.4, 1], [0.6, 0]]],
    ['piers', [[0, 3], [0.5, 3], [0.7, 0.5], [0.85, 0]]],
    ['band', [[0.35, 0], [0.5, 2], [0.8, 1], [1, 0.3]]],
    ['curtain', [[0.5, 0], [0.7, 3], [1, 6]]],
  ],
  tiles: [
    // Blank only where something blocks the wall: towers keep a strict grid.
    tile('blank', 'wall', 'blank', { weight: 0 }),
    tile('win_punched', 'window', 'window', {
      variant: 'punched',
      weight: 6,
      params: { w: 0.4, h: 0.55, sill: 0.25, frame: 1, mullionH: 1, sillBox: 1 },
    }),
    tile('win_piers', 'window', 'window', {
      variant: 'piers',
      weight: 6,
      params: { w: 0.56, h: 0.6, sill: 0.22, mullionH: 1, fins: 0.32, finW: 0.42 },
    }),
    tile('win_band', 'window', 'window', {
      variant: 'band',
      weight: 8,
      h: 'band',
      params: { w: 1, h: 0.45, sill: 0.3, frame: 0, mullionV: 2 },
    }),
    tile('curtain', 'window', 'window', {
      variant: 'curtain',
      weight: 10,
      h: 'band',
      params: { w: 1, h: 0.9, sill: 0.05, frame: 0, mullionV: 1, mullionH: 1 },
    }),
    tile('podium_stone', 'window', 'window', {
      variant: 'podium_stone',
      weight: 6,
      params: { w: 0.62, h: 0.68, sill: 0.14, frame: 1, mullionV: 1, mullionH: 1, fins: 0.18, finW: 0.5 },
    }),
    tile('podium_glass', 'window', 'window', {
      variant: 'podium_glass',
      weight: 6,
      h: 'band',
      params: { w: 1, h: 0.92, sill: 0.04, frame: 0, mullionV: 2, mullionH: 1 },
    }),
    tile('louvre', 'window', 'window', {
      variant: 'plant',
      weight: 3,
      params: { w: 0.7, h: 0.6, sill: 0.2, frame: 0, louvre: 1 },
    }),
    tile('plant_blank', 'wall', 'blank', { variant: 'plant', weight: 1.5 }),
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 2.2, h: 2.6, canopy: 2, glass: 0.85, double: 1 },
    }),
    tile('lobby', 'shopfront', 'shop', { rows: GROUND, weight: 3, params: { base: 0.25 } }),
  ],
  symmetry: 0.9,
  // Piers and setbacks carry the old towers; bands would cut across the piers.
  trim: undefined,
  // Caps and spires: copper, slate and metal rather than tiles.
  palette: {
    ...office.palette,
    roof: [['#5f8a78', [[0, 3], [0.5, 1], [1, 0]]], ['#3f4347', 3], ['#6a6f76', [[0, 1], [1, 3]]]],
  },
  tower: {
    podiumLevels: [[1, 1], [2, 3], [3, 2], [4, 1]],
    podiumVariants: [
      ['podium_stone', [[0, 4], [0.45, 2], [0.6, 0]]],
      ['podium_glass', [[0.3, 0], [0.6, 3], [1, 5]]],
    ],
    crowns: [
      ['setback', [[0, 4], [0.35, 3], [0.45, 0]]],
      ['tower', [[0, 2], [0.35, 1.5], [0.45, 0]]],
      ['penthouse', [[0.3, 0], [0.45, 4], [0.7, 3], [0.85, 0]]],
      ['glass', [[0.6, 0], [0.8, 2], [1, 3]]],
      ['chamfer', [[0.6, 0], [0.8, 1.5], [1, 2]]],
      ['spire', [[0.6, 0], [0.8, 1], [1, 2]]],
    ],
    plantVariant: 'plant',
    glassVariant: 'curtain',
  },
};

const industrial: TypeStyle = {
  levelHeight: [[0, 6], [1, 8]],
  groundExtra: 0,
  levels: [[1, 1]],
  roofShapes: [
    ['flat', [[0, 2], [1, 6]]],
    ['gabled', [[0, 5], [1, 2.5]]],
    ['skillion', 0.8],
    ['sawtooth', [[0, 3], [0.4, 2.5], [0.7, 0.3], [1, 0]]],
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
    tile('dock', 'garageDoor', 'dock', { rows: GROUND, params: { w: 0.62, h: 3, lines: 6, dock: 1 } }),
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
      params: { w: 0.42, h: 0.52, sill: 0.2, frame: 1, mullionV: 1, mullionH: 1, sillBox: 1, arch: 0.32 },
    }),
    tile('win_glass', 'window', 'window', {
      variant: 'modern',
      weight: 9,
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
  symmetry: [[0, 1], [0.45, 1], [0.6, 0.6], [1, 0.4]],
  flatOverhang: [[0.5, 0], [0.65, 1.4], [1, 2.2]],
  platform: {
    depth: [[0, 4], [1, 4.6]],
    height: [[0, 3.9], [1, 3.6]],
    leanTo: [[0, 1], [0.45, 0.8], [0.6, 0]],
  },
  trim: OLD_TRIM,
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
    tile('shopdoor', 'shopfront', 'shopdoor', { rows: GROUND, params: { base: 0.35, door: 1, canopy: 1 } }),
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 1.0, h: 2.1, glass: 0 } }),
    // Deliveries: one roller door on a side wall (placed by the layout, never by the solver).
    tile('roller', 'garageDoor', 'garage', { rows: GROUND, minWidth: 2.8, params: { w: 0.8, h: 3, lines: 6 } }),
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

/** Posts and slab; also used for station platform roofs. */
const CANOPY: CanopyStyle = {
  post: [[0, 0.3], [1, 0.2]],
  spacing: [[0, 4.5], [1, 6]],
  fascia: [[0, 0.28], [0.5, 0.4], [1, 0.65]],
};

/** Roof on posts. No walls, so the only tile is the blank one the validator asks for. */
const canopy: TypeStyle = {
  // Resolve scales the default height with the footprint (carport to fuel station).
  levelHeight: [[0, 3.2], [1, 3.4]],
  groundExtra: 0,
  levels: [[1, 1]],
  roofShapes: [
    ['flat', [[0, 2], [0.5, 4], [1, 8]]],
    ['gabled', [[0, 3], [0.5, 1], [1, 0.2]]],
    ['skillion', [[0, 1], [1, 1.5]]],
  ],
  roofPitch: [[0, 22], [1, 12]],
  roofPitchSpread: 4,
  overhang: 0.3,
  parapet: 0,
  bayWidth: 4,
  plinth: 0,
  wallStyles: [['plain', 1]],
  tiles: [tile('blank', 'wall', 'blank')],
  sockets: LOOSE,
  symmetry: 0,
  canopy: CANOPY,
  palette: {
    wall: [['#d8d8d2', 3], ['#f2efe6', 2], ['#5a6067', [[0, 0.5], [1, 2]]], ['#7a5a3e', [[0, 3], [0.6, 0.3]]]],
    roofFlat: [['#8a8d90', 3], ['#b8bcc0', 2]],
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
  industrial: {
    clutter: 0.7,
    skylights: [[0, 0.6], [1, 0.8]],
    ridgeVent: [[0, 0.6], [0.6, 0.3], [1, 0]],
    chimneyStack: [[0, 0.5], [0.4, 0.3], [0.55, 0]],
  },
  station: {
    chimney: [[0, 0.6], [0.5, 0]],
    clutter: 0.4,
    turret: [[0, 0.6], [0.45, 0.4], [0.5, 0]],
  },
  store: { clutter: 0.8, falseFront: [[0, 0.9], [0.6, 0.7], [1, 0.4]] },
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
  canopy,
};

export const dePack: StylePack = { id: 'de', version: 1, palette, types: deTypes };
