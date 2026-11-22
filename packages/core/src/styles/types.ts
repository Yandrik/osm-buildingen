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

export interface RoofDetailStyle {
  /** Dormers on pitched roofs. */
  dormer?: Curve;
  chimney?: Curve;
  /** Small window in each gable wall. */
  atticWindow?: Curve;
  /** Units and a stair head on flat roofs. */
  clutter?: Curve;
  /** Rows of glazed strips on flat roofs (halls). */
  skylights?: Curve;
  /** Raised vent along the ridge of a gabled roof (halls). */
  ridgeVent?: Curve;
  /** One tall factory chimney on the roof, near a corner. */
  chimneyStack?: Curve;
  /** Small clock turret on the ridge (old stations). */
  turret?: Curve;
  /** Raised front above the street wall of a flat roof, carrying a sign (stores). */
  falseFront?: Curve;
}

/**
 * Tower crowns, see plan/styles/non-residential.md:
 *   setback    two or three tiers, each inset further, the last with a hipped or pyramidal cap
 *   tower      one or two setbacks and a slender tower with a pyramidal roof
 *   penthouse  flat top with a recessed plant storey
 *   glass      a taller inset glass top storey
 *   chamfer    the top storeys cut off by a single slope
 *   spire      plant storey and a thin spire
 */
export type CrownKind = 'setback' | 'tower' | 'penthouse' | 'glass' | 'chamfer' | 'spire';

/** Podium, shaft and crown of tall buildings (`pipeline/autoParts.ts`). */
export interface TowerStyle {
  /** Levels of the podium, the base that covers the whole footprint. */
  podiumLevels: Weighted<number>;
  /** Facade variants of the podium; '' keeps the building's own variant. */
  podiumVariants: Weighted<string>;
  crowns: Weighted<CrownKind>;
  /** Facade variant of plant storeys and spire bases. */
  plantVariant: string;
  /** Facade variant of glass top storeys. */
  glassVariant: string;
}

/** Roofs on posts: the canopy type and station platform roofs. */
export interface CanopyStyle {
  /** Post width in metres. */
  post: Curve;
  /** Largest distance between posts along an edge. */
  spacing: Curve;
  /** Thickness of the roof slab edge (fascia). */
  fascia: Curve;
}

/** Platform roof along the rail side of a station. */
export interface PlatformStyle {
  /** Depth from the wall, metres. */
  depth: Curve;
  /** Height of the roof edge above the ground. */
  height: Curve;
  /** Probability of a lean-to roof instead of a flat slab. */
  leanTo: Curve;
}

/** Horizontal trim on the walls. Probabilities per building. */
export interface TrimStyle {
  /** Slim band at every level line. */
  band?: Curve;
  /** Cornice under the eave or parapet. */
  cornice?: Curve;
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
  /** Probability that the building gets a garage door at one end of its street wall. */
  attachedGarage?: Curve;
  /** Probabilities (per building) of roof decoration. Left out = none. */
  roofDetails?: RoofDetailStyle;
  /** Replaces single palette lists of the pack for this type. */
  palette?: Partial<PaletteSet>;
  /** Reuse the plot's wall colour (garages, sheds). */
  inheritsGroupWall?: boolean;
  /** Eave overhang of flat roofs in metres (a slab reaching past the walls). Default 0. */
  flatOverhang?: Curve;
  /** Podium, shaft and crown for tall buildings. Left out = plain prism. */
  tower?: TowerStyle;
  /** Posts and slab of roofs on posts. */
  canopy?: CanopyStyle;
  /** Platform roof when a rail line runs along the building. */
  platform?: PlatformStyle;
  /** Level bands and cornice. Left out = none. */
  trim?: TrimStyle;
}

export interface StylePack {
  id: string;
  version: number;
  palette: PaletteSet;
  types: Readonly<Record<BuildingType, TypeStyle>>;
}
