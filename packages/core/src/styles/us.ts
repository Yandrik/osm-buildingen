import type { BuildingType } from '../types';
import { GROUND, LOOSE, STACKING, UP, deTypes, tile } from './de';
import type { FacadeTile, PaletteSet, StylePack, TypeStyle } from './types';

/**
 * US suburban style pack. See plan/styles/us-suburban.md.
 *
 * Houses differ most from the German pack: siding colours, lower roofs with wide
 * eaves, sash windows with shutters, porches and attached garages. Commercial and
 * industrial types reuse the German definitions with this pack's palette.
 */

const palette: PaletteSet = {
  wall: [
    ['#f1efe8', [[0, 3], [0.6, 2], [1, 5]]],
    ['#d9cfb8', 3],
    ['#b9bdb8', [[0, 1], [1, 3]]],
    ['#a9bccb', 1.5],
    ['#a8b59a', 1.5],
    ['#e6dba8', [[0, 1.5], [1, 0.4]]],
    ['#9a4a3a', [[0, 2.5], [0.5, 1.5], [1, 0.3]]],
    ['#7c8a96', [[0.3, 0.5], [1, 1.5]]],
    ['#c9a98a', 1],
    ['#3f464d', [[0.8, 0], [1, 1.2]]],
  ],
  roof: [
    ['#4a4d52', 4],
    ['#5a4a40', 3],
    ['#6b6f73', 2.5],
    ['#3b3f44', 2],
    ['#5f6b58', 0.8],
    ['#7a3f33', 0.8],
  ],
  roofFlat: [
    ['#8f8f8a', 3],
    ['#5e6164', 2],
    ['#d9d9d4', 1],
  ],
  trim: [
    ['#f7f7f2', 8],
    ['#2f3236', [[0.7, 0], [1, 3]]],
    ['#d8d2c2', 1],
  ],
  door: [
    ['#7a2e2a', 2.5],
    ['#2f4a6a', 2],
    ['#2f3236', 2],
    ['#3f5d48', 1.2],
    ['#a8743e', 1.5],
    ['#f1efe8', 1],
    ['#d9a441', 0.5],
  ],
  accent: [
    ['#2f3236', 3],
    ['#3f5d48', 1.5],
    ['#2f4a6a', 1.5],
    ['#7a2e2a', 1.5],
    ['#5a4a40', 1],
  ],
  timber: [['#4a3426', 1]],
  glass: '#a9cbdc',
  frame: [
    ['#f7f7f2', [[0, 5], [1, 2]]],
    ['#2f3236', [[0.7, 0], [1, 3]]],
  ],
};

/**
 * `sash`: upright double-hung windows, shutters on some houses.
 * `picture`: post-war, wide living-room windows.
 * `modern`: black frames, tall glass.
 */
const houseWindows: FacadeTile[] = [
  tile('win_sash', 'window', 'window', {
    variant: 'sash',
    weight: 4,
    params: { w: 0.34, h: 0.52, sill: 0.28, frame: 1, mullionH: 1, sillBox: 1 },
  }),
  tile('win_sash_shutters', 'window', 'window', {
    variant: 'shutters',
    weight: 4,
    params: { w: 0.32, h: 0.52, sill: 0.28, frame: 1, mullionH: 1, sillBox: 1, shutters: 1 },
  }),
  tile('win_picture', 'window', 'window', {
    variant: 'picture',
    weight: 2,
    minWidth: 2.6,
    rows: GROUND,
    params: { w: 0.68, h: 0.46, sill: 0.3, frame: 1, mullionV: 2 },
  }),
  tile('win_picture_small', 'window', 'window', {
    variant: 'picture',
    weight: 3,
    params: { w: 0.4, h: 0.42, sill: 0.36, frame: 1, mullionV: 1 },
  }),
  tile('win_modern', 'window', 'window', {
    variant: 'modern',
    weight: 3,
    params: { w: 0.42, h: 0.6, sill: 0.22, frame: 0, mullionH: 1 },
  }),
  tile('win_modern_wide', 'window', 'window', {
    variant: 'modern',
    weight: 1.5,
    minWidth: 2.8,
    params: { w: 0.7, h: 0.6, sill: 0.22, frame: 0, mullionV: 2 },
  }),
];

const house: TypeStyle = {
  levelHeight: [[0, 2.9], [0.5, 2.6], [1, 2.9]],
  groundExtra: 0,
  levels: [
    [1, [[0, 2], [0.5, 6], [0.75, 2], [1, 2]]],
    [2, [[0, 6], [0.5, 2], [0.75, 6], [1, 5]]],
  ],
  roofShapes: [
    ['gabled', [[0, 7], [0.5, 4], [1, 6]]],
    ['hipped', [[0, 2], [0.5, 6], [1, 3]]],
    ['gambrel', [[0, 1], [0.3, 0.3], [0.5, 0]]],
    ['flat', [[0.85, 0], [1, 1]]],
  ],
  roofPitch: [[0, 38], [0.5, 20], [0.8, 30], [1, 33]],
  roofPitchSpread: 4,
  overhang: [[0, 0.35], [0.5, 0.65], [1, 0.45]],
  parapet: 0.3,
  bayWidth: [[0, 2.6], [0.5, 3.0], [1, 3.0]],
  plinth: [[0, 0.45], [0.5, 0.2], [1, 0.15]],
  wallStyles: [['siding', 1]],
  variants: [
    ['sash', [[0, 2], [0.4, 1], [0.6, 0.5], [0.8, 2], [1, 0.5]]],
    ['shutters', [[0, 2.5], [0.4, 1], [0.6, 0.5], [0.8, 2.5], [1, 0.3]]],
    ['picture', [[0.3, 0], [0.5, 4], [0.7, 1], [0.85, 0]]],
    ['modern', [[0.85, 0], [1, 4]]],
  ],
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 1.3 }),
    ...houseWindows,
    tile('door', 'door', 'door', {
      rows: GROUND,
      params: { w: 1.0, h: 2.1, step: 1, glass: 0.25, porch: 1 },
    }),
    tile('garage_door', 'garageDoor', 'garage', { rows: GROUND, params: { w: 0.88, h: 2.15, lines: 4 } }),
  ],
  sockets: STACKING,
  symmetry: [[0, 0.75], [0.5, 0.2], [0.8, 0.5], [1, 0.3]],
  attachedGarage: [[0.3, 0], [0.5, 0.75], [1, 0.8]],
  roofDetails: {
    dormer: [[0, 0.5], [0.5, 0.1], [0.8, 0.5], [1, 0.3]],
    chimney: [[0, 0.8], [0.6, 0.5], [1, 0.2]],
    atticWindow: [[0, 0.5], [1, 0.4]],
  },
};

const apartments: TypeStyle = {
  ...deTypes.apartments,
  wallStyles: [['siding', 1]],
  variants: house.variants,
  tiles: [
    tile('blank', 'wall', 'blank', { weight: 0.7 }),
    ...houseWindows,
    tile('door', 'door', 'door', { rows: GROUND, params: { w: 1.3, h: 2.2, canopy: 1, step: 1, glass: 0.6 } }),
    tile('balcony', 'balcony', 'balcony', { rows: UP, weight: 1.2, minWidth: 2.4, params: { depth: 1.3 } }),
    tile('shopfront', 'shopfront', 'shop', { rows: GROUND, params: { base: 0.4 } }),
    tile('shopdoor', 'shopfront', 'shopdoor', { rows: GROUND, params: { base: 0.4, door: 1 } }),
  ],
  roofShapes: [
    ['flat', [[0, 3], [1, 6]]],
    ['hipped', 3],
    ['gabled', 2],
  ],
  roofPitch: [[0, 30], [1, 22]],
  overhang: 0.5,
};

const townhouse: TypeStyle = {
  ...apartments,
  levelHeight: [[0, 3.3], [1, 3.0]],
  groundExtra: [[0, 0.5], [1, 0.4]],
  levels: [
    [2, 3],
    [3, 4],
    [4, 1],
  ],
  roofShapes: [
    ['flat', 6],
    ['gabled', 2],
    ['mansard', [[0, 2], [0.5, 0]]],
  ],
  bayWidth: 2.6,
  wallStyles: [['brick', 1]],
  palette: {
    wall: [
      ['#9a4a3a', 4],
      ['#7e3f33', 2],
      ['#b9a58c', 2],
      ['#d9cfb8', 1.5],
      ['#6f7378', 1],
    ],
  },
};

const garage: TypeStyle = {
  ...deTypes.garage,
  roofShapes: [
    ['gabled', 6],
    ['hipped', 2],
    ['flat', 1],
  ],
  roofPitch: [[0, 30], [1, 24]],
  overhang: 0.35,
  sockets: LOOSE,
};

const shed: TypeStyle = {
  ...deTypes.shed,
  roofShapes: [
    ['gabled', 5],
    ['gambrel', 2],
    ['skillion', 2],
  ],
  roofPitch: 28,
  palette: {
    wall: [
      ['#8a3a30', 3],
      ['#d9cfb8', 2],
      ['#6f7a6a', 1.5],
      ['#8a8f94', 1.5],
      ['#f1efe8', 1],
    ],
    roof: palette.roof,
  },
};

const types: Record<BuildingType, TypeStyle> = {
  ...deTypes,
  house,
  apartments,
  townhouse,
  garage,
  shed,
};

export const usPack: StylePack = { id: 'us', version: 1, palette, types };
