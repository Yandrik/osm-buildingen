import type { BuildingType, Faith, PartVolume, RoofProfile, RoofShape, WallStyle } from '../types';

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
  | 'arch'
  | 'clock';

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
  /** Widest cell the solver may put the tile in (a slit looks lost in a wide bay). Left out = any. */
  maxWidth?: number;
  /** Only used on buildings that rolled this variant (see TypeStyle.variants). */
  variant?: string;
  /** Only used on these volumes (ResolvedSpec.volume). Left out = every volume. */
  volumes?: readonly PartVolume[];
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
  /**
   * Roofs of the towers of a place of worship (slate, copper, lead), where neither the
   * part nor the building has a mapped roof colour. Left out = the roof colour.
   */
  spire?: Weighted<string>;
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
  /** Round window high in each gable wall (places of worship). */
  gableOculus?: Curve;
  /** Ball and cross (or what the faith asks for) on the tip of a tower roof (places of worship). */
  finial?: Curve;
}

/** A stage standing on the shaft of a steeple. Sizes are multiples of the shaft's width. */
export interface SteepleStage {
  /** Square like the shaft, or an octagon whose flats run along the shaft's sides. */
  plan: 'square' | 'octagon';
  width: number;
  /** Height of its walls. */
  walls: number;
}

/**
 * One design for the tower or ridge turret of a church mapped without parts
 * (pipeline/volumes.ts builds it as parts, so the far massing view has it too).
 * From the bottom: the shaft, stages on it, and a roof on the top stage.
 */
export interface SteepleStyle {
  /** Facade variants (architectures) it suits. Left out = all. */
  variants?: readonly string[];
  /** Faiths it is built for. Left out = 'christian' only. */
  faiths?: readonly Faith[];
  weight: Curve;
  /** Plan of the shaft; towers are always square. Left out = square. */
  plan?: 'square' | 'octagon';
  /** Height of the shaft's walls above the ridge of the nave, in shaft widths. */
  rise: number;
  stages?: readonly SteepleStage[];
  /** Roof of the top stage (or of the shaft): height in widths of what it stands on. */
  roof: { shape: RoofShape; height: number; profile?: RoofProfile; colour?: string };
  /** Pinnacles on the four corners of the shaft, beside the first stage. Sizes in shaft widths. */
  pinnacles?: { width: number; walls: number; roof: number };
}

/** Rows of the facade grid by volume, instead of `levelHeight` (places of worship). */
export interface VolumeRows {
  /** Metres per row on the main body. */
  main: Curve;
  /** Towers: row height as a multiple of the tower's width, within these limits (metres). */
  towerPerWidth: number;
  towerMin: number;
  towerMax: number;
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

/** Railing of a balcony: solid panels, glass, thin metal bars, or wooden boards. */
export type RailingKind = 'solid' | 'glass' | 'bars' | 'wood';

/**
 * How balconies spread over a wall. Whatever is picked repeats on every upper
 * storey, so balconies always line up:
 *   single  one balcony per wall, near the middle
 *   rhythm  balconies with a gap of one bay between them, across the wall
 *   band    one balcony along each run of windows
 */
export type BalconyLayout = 'single' | 'rhythm' | 'band';

/** Balconies, placed after the facade solve (see plan/pipeline/04-facade-wfc.md). */
export interface BalconyStyle {
  /** Probability per building of having balconies at all. */
  chance: Curve;
  railings: Weighted<RailingKind>;
  /** Colours of bar railings. */
  metal: Weighted<string>;
  /** Colours of wooden railings and their slab. */
  wood: Weighted<string>;
  /** Slab depth in metres. */
  depth: Curve;
  layouts: Weighted<BalconyLayout>;
  /** Bays (windows) per balcony; above 1 several windows share one balcony. */
  spans: Weighted<number>;
  /** Probability of balconies on a second wall, the one facing away from the first. */
  secondWall: Curve;
}

/** Horizontal trim on the walls. Probabilities per building. */
export interface TrimStyle {
  /** Slim band at every level line. */
  band?: Curve;
  /** Cornice under the eave or parapet. */
  cornice?: Curve;
  /** Walls shorter than this (metres) get no trim. Default 1. */
  minWall?: number;
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
  /**
   * Share of a cell, around its middle, that a neighbour must leave free for an
   * opening (see context.isBlocked). Left out = 1, the whole cell. Narrow centred
   * openings (church towers between corner turrets) can do with less.
   */
  openingProbe?: number;
  /**
   * Where a slim part of the same building stands against a wall (a mapped buttress),
   * the bays are laid out between such piers instead of evenly along the wall, and
   * cells learn which of their edges are free (FacadeCell.params `edgeL`, `edgeR`).
   */
  pierBays?: boolean;
  /**
   * The roof ignores buttress-sized bumps in the outline: its eave runs straight past
   * them and each gets a flat top at the eave (roofs/eaves.ts).
   */
  straightEaves?: boolean;
  /**
   * Gabled roofs need only one gable end on outlines that are not plain rectangles;
   * the other ends are hipped, as over the apse of a church (roofs/gabled.ts).
   */
  hippedEnds?: boolean;
  /** Facade rows by volume instead of by level; the level count is then ignored. */
  rows?: VolumeRows;
  /** Towers and ridge turrets for buildings of this type mapped without parts. */
  steeples?: {
    towers: readonly SteepleStyle[];
    turrets: readonly SteepleStyle[];
    /**
     * Probability that a plain rectangle gets a polygonal east end (apse): its two
     * east corners are cut off, inside the outline, and the roof is hipped over them.
     */
    apse?: Curve;
  };
  /** Probability (per building) of clock faces on its towers. Needs a tile with role 'clock'. */
  towerClock?: Curve;
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
  /** Balconies on upper storeys. Needs a tile with role 'balcony' (the door). Left out = none. */
  balconies?: BalconyStyle;
  /**
   * Probability of a ground-floor store when the input does not decide (`shop`,
   * `shopProbability`). Left out = the type never gets one. Needs shop tiles.
   */
  shop?: Curve;
}

export interface StylePack {
  id: string;
  version: number;
  palette: PaletteSet;
  types: Readonly<Record<BuildingType, TypeStyle>>;
}
