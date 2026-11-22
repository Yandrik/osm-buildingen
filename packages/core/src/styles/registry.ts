import { PIECES } from '../pieces';
import { BUILDING_TYPES, ROOF_SHAPES } from '../types';
import type { FacadeTile, StylePack } from './types';

const packs = new Map<string, StylePack>();

export const MAX_TILES_PER_TYPE = 32;

/** Checks a style pack and throws a readable error for the first problem found. */
export function validateStylePack(pack: StylePack): void {
  const fail = (message: string): never => {
    throw new Error(`Style pack "${pack.id}": ${message}`);
  };
  if (!pack.id) fail('missing id');
  for (const type of BUILDING_TYPES) {
    const style = pack.types[type];
    if (!style) {
      fail(`missing type "${type}"`);
      continue;
    }
    const where = `type "${type}"`;
    if (style.tiles.length === 0) fail(`${where} has no tiles`);
    if (style.tiles.length > MAX_TILES_PER_TYPE) fail(`${where} has more than ${MAX_TILES_PER_TYPE} tiles`);
    const ids = new Set<string>();
    for (const tile of style.tiles) {
      if (ids.has(tile.id)) fail(`${where} has duplicate tile "${tile.id}"`);
      ids.add(tile.id);
      if (!(tile.piece in PIECES)) fail(`${where} tile "${tile.id}" names unknown piece "${tile.piece}"`);
      if (tile.rows.length === 0) fail(`${where} tile "${tile.id}" has no rows`);
      for (const key of ['left', 'right'] as const) {
        if (!(tile[key] in style.sockets.h))
          fail(`${where} tile "${tile.id}" uses unknown h-connector "${tile[key]}"`);
      }
      for (const key of ['up', 'down'] as const) {
        if (!(tile[key] in style.sockets.v))
          fail(`${where} tile "${tile.id}" uses unknown v-connector "${tile[key]}"`);
      }
    }
    const fitsBlocked = (t: FacadeTile): boolean => t.blockedOk === true;
    for (const row of ['ground', 'upper', 'top'] as const) {
      if (!style.tiles.some((t) => fitsBlocked(t) && t.role === 'blank' && t.rows.includes(row))) {
        fail(`${where} needs a blank tile with blockedOk for row "${row}"`);
      }
    }
    for (const [shape] of style.roofShapes) {
      if (!ROOF_SHAPES.includes(shape)) fail(`${where} has unknown roof shape "${shape}"`);
    }
    if (style.levels.length === 0) fail(`${where} has no level table`);
    if (style.roofShapes.length === 0) fail(`${where} has no roof shapes`);
    if (style.wallStyles.length === 0) fail(`${where} has no wall styles`);
  }
}

export function registerStylePack(pack: StylePack): void {
  validateStylePack(pack);
  packs.set(pack.id, pack);
}

export function getStylePack(id: string): StylePack {
  const pack = packs.get(id);
  if (!pack)
    throw new Error(`Unknown style pack "${id}". Registered: ${[...packs.keys()].join(', ') || 'none'}`);
  return pack;
}

export function listStylePacks(): string[] {
  return [...packs.keys()];
}
