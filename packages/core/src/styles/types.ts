import type { BuildingType, RoofShape, WallStyle } from '../types';

/**
 * A value that depends on the era (0 = old, 1 = new): either a constant or
 * (era, value) points with linear interpolation between them.
 */
export type Curve = number | readonly (readonly [number, number])[];

export function evalCurve(curve: Curve, era: number): number {
  if (typeof curve === 'number') return curve;
  const n = curve.length;
  if (n === 0) return 0;
  const first = curve[0] as readonly [number, number];
  if (era <= first[0]) return first[1];
  for (let i = 1; i < n; i++) {
    const a = curve[i - 1] as readonly [number, number];
    const b = curve[i] as readonly [number, number];
    if (era <= b[0]) {
      const t = b[0] > a[0] ? (era - a[0]) / (b[0] - a[0]) : 0;
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return (curve[n - 1] as readonly [number, number])[1];
}

export type Weighted<T> = readonly (readonly [T, Curve])[];

export type RowKind = 'ground' | 'upper' | 'top';

/** What a tile is, for the rules that plain adjacency cannot express. */
export type TileRole =
  | 'blank'
  | 'window'
  | 'door'
  | 'garage'
  | 'shop'
  | 'shopdoor'
  | 'balcony'
  | 'dock'
  | 'arch';

export interface FacadeTile {
  id: string;
  /** Name of the piece that draws the cell (see pieces/index.ts). */
  piece: string;
  params?: Readonly<Record<string, number>>;
  role: TileRole;
  /** Rows the tile may appear in. A single-level building's row counts as 'ground'. */
  rows: readonly RowKind[];
  /** Horizontal connectors, seen from outside. */
  left: string;
  right: string;
  /** Vertical connectors. */
  up: string;
  down: string;
  weight: Curve;
  /** True if the tile may sit on a blocked cell (no opening). */
  blockedOk?: boolean;
  /** Minimum cell width in metres the piece needs. */
  minWidth?: number;
  /** Only used on buildings that rolled this variant (see TypeStyle.variants). */
  variant?: string;
}

/**
 * Which connectors fit together. `h[x]` lists the left-connectors accepted to the
 * right of a tile whose right-connector is x; `v[x]` lists the down-connectors
 * accepted above a tile whose up-connector is x.
 */
export interface SocketTable {
  h: Readonly<Record<string, readonly string[]>>;
  v: Readonly<Record<string, readonly string[]>>;
}

export interface PaletteSet {
  wall: Weighted<string>;
  roof: Weighted<string>;
  /** Roof colours used for flat roofs. */
  roofFlat: Weighted<string>;
  trim: Weighted<string>;
  door: Weighted<string>;
  accent: Weighted<string>;
  timber: Weighted<string>;
  glass: string;
  frame: Weighted<string>;
}

export interface TypeStyle {
  /** Metres per level. */
  levelHeight: Curve;
  /** Extra height of the ground level (stores, offices). */
  groundExtra: Curve;
  /** Number of levels when nothing is given. */
  levels: Weighted<number>;
  roofShapes: Weighted<RoofShape>;
  /** Roof pitch in degrees, and how much it varies (+-). */
  roofPitch: Curve;
  roofPitchSpread: number;
  /** Eave overhang in metres. */
  overhang: Curve;
  /** Parapet height for flat roofs. */
  parapet: Curve;
  bayWidth: Curve;
  plinth: Curve;
  wallStyles: Weighted<WallStyle>;
  /**
   * Building-wide facade variants (for example window styles). One is rolled per
   * building; tiles naming another variant are left out. Optional.
   */
  variants?: Weighted<string>;
  tiles: readonly FacadeTile[];
  sockets: SocketTable;
  /** Probability of mirroring the street wall around its centre. */
  symmetry: Curve;
  /** Replaces single palette lists of the pack for this type. */
  palette?: Partial<PaletteSet>;
  /** Reuse the plot's wall colour (garages, sheds). */
  inheritsGroupWall?: boolean;
}

export interface StylePack {
  id: string;
  version: number;
  palette: PaletteSet;
  types: Readonly<Record<BuildingType, TypeStyle>>;
}
