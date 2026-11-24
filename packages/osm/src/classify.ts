import type { BuildingType, Faith } from '@osm-buildingen/core';
import type { Tags } from './types';

/*
 * Tag -> building type tables. Data, so that new values are one line each.
 * Order of evaluation (see `classify`):
 *   1. skip rules (SKIP_BUILDING, location=underground)
 *   2. special buildings (SPECIAL_*), emitted as massing (places of worship are a type, see BUILDING_TYPE)
 *   3. BUILDING_TYPE[building]
 *   4. for building=yes and unknown values: OTHER_TYPE rules on other tags
 *   5. shop on the building or a shop node inside it
 *   6. undefined: core guesses from size
 */

/** `building=*` values that are not built at all. */
export const SKIP_BUILDING: ReadonlySet<string> = new Set([
  'no',
  'none',
  'proposed',
  // Under construction: the outline is often the site, and the finished look is unknown.
  'construction',
  'demolished',
  'destroyed',
  'razed',
  'removed',
  'not_built',
  'abandoned:yes',
]);

/** Marker for `building=residential`: house or apartments, decided by size. */
export const RESIDENTIAL = 'residential-by-size';

export const BUILDING_TYPE: Readonly<Record<string, BuildingType | typeof RESIDENTIAL>> = {
  house: 'house',
  detached: 'house',
  semidetached_house: 'house',
  semi_detached: 'house',
  bungalow: 'house',
  farm: 'house',
  cabin: 'house',
  villa: 'house',
  // Parish house: next to the church, a large old house rather than apartments.
  presbytery: 'house',
  residential: RESIDENTIAL,
  apartments: 'apartments',
  dormitory: 'apartments',
  flats: 'apartments',
  hotel: 'apartments',
  terrace: 'townhouse',
  terraced_house: 'townhouse',
  townhouse: 'townhouse',
  garage: 'garage',
  garages: 'garage',
  carport: 'canopy',
  shed: 'shed',
  hut: 'shed',
  allotment_house: 'shed',
  // Roofs on posts: fuel stations, platforms, shelters, carports.
  roof: 'canopy',
  canopy: 'canopy',
  greenhouse: 'shed',
  toilets: 'shed',
  service: 'shed',
  container: 'shed',
  kiosk: 'store',
  office: 'office',
  government: 'office',
  public: 'office',
  civic: 'office',
  school: 'office',
  college: 'office',
  university: 'office',
  kindergarten: 'office',
  hospital: 'office',
  fire_station: 'office',
  townhall: 'office',
  commercial: 'office',
  industrial: 'industrial',
  warehouse: 'industrial',
  manufacture: 'industrial',
  factory: 'industrial',
  hangar: 'industrial',
  barn: 'industrial',
  farm_auxiliary: 'industrial',
  stable: 'industrial',
  cowshed: 'industrial',
  sty: 'industrial',
  parking: 'industrial',
  sports_hall: 'industrial',
  retail: 'store',
  supermarket: 'store',
  shop: 'store',
  train_station: 'station',
  transportation: 'station',
  church: 'worship',
  cathedral: 'worship',
  chapel: 'worship',
  basilica: 'worship',
  mosque: 'worship',
  synagogue: 'worship',
  temple: 'worship',
  shrine: 'worship',
  religious: 'worship',
};

/** Type rules on other tags, tried in order for `building=yes` and unknown values. */
export const OTHER_TYPE: readonly { key: string; values?: readonly string[]; type: BuildingType }[] = [
  { key: 'amenity', values: ['place_of_worship'], type: 'worship' },
  { key: 'railway', values: ['station', 'halt'], type: 'station' },
  { key: 'public_transport', values: ['station'], type: 'station' },
  { key: 'amenity', values: ['bus_station', 'ferry_terminal'], type: 'station' },
  // Shelters are roofs on posts, except the kinds that have walls.
  { key: 'shelter_type', values: ['basic_hut', 'lean_to', 'rock_shelter', 'weather_shelter'], type: 'shed' },
  { key: 'amenity', values: ['shelter'], type: 'canopy' },
  { key: 'shelter_type', type: 'canopy' },
  { key: 'office', type: 'office' },
  {
    key: 'amenity',
    values: [
      'townhall',
      'library',
      'school',
      'college',
      'university',
      'hospital',
      'courthouse',
      'police',
      'fire_station',
      'kindergarten',
      'public_building',
      'bank',
      'post_office',
      'clinic',
      'arts_centre',
      'theatre',
      'cinema',
      'community_centre',
    ],
    type: 'office',
  },
  { key: 'tourism', values: ['hotel', 'hostel', 'guest_house'], type: 'apartments' },
  { key: 'amenity', values: ['parking'], type: 'industrial' },
  { key: 'man_made', values: ['works'], type: 'industrial' },
  { key: 'industrial', type: 'industrial' },
];

/** `building=*` values that mark a special (landmark) building. */
export const SPECIAL_BUILDING: ReadonlySet<string> = new Set([
  'monastery',
  'castle',
  'palace',
  'fort',
  'tower',
  'bell_tower',
  'water_tower',
  'transformer_tower',
  'silo',
  'bunker',
  'ruins',
  'stadium',
  'grandstand',
  'triumphal_arch',
  'gatehouse',
]);

/**
 * `building:architecture` -> facade variant of the worship type (see the core style
 * pack). Only used for places of worship; other types have variants of their own.
 */
export const WORSHIP_ARCHITECTURE: Readonly<Record<string, string>> = {
  romanesque: 'romanesque',
  'neo-romanesque': 'romanesque',
  romanesque_revival: 'romanesque',
  gothic: 'gothic',
  'neo-gothic': 'gothic',
  gothic_revival: 'gothic',
  brick_gothic: 'gothic',
  'brick-gothic': 'gothic',
  baroque: 'classic',
  'neo-baroque': 'classic',
  rococo: 'classic',
  renaissance: 'classic',
  'neo-renaissance': 'classic',
  classicism: 'classic',
  neoclassicism: 'classic',
  historicism: 'classic',
  modern: 'modern',
  brutalist: 'modern',
  brutalism: 'modern',
  postmodern: 'modern',
  contemporary: 'modern',
};

/** `religion` -> faith of a place of worship (core `BuildingInput.faith`). Unknown religions are 'other'. */
export const RELIGION_FAITH: Readonly<Record<string, Faith>> = {
  christian: 'christian',
  muslim: 'muslim',
  jewish: 'jewish',
};

/** `building` values that say whose place of worship it is when `religion` is missing. */
export const BUILDING_FAITH: Readonly<Record<string, Faith>> = {
  church: 'christian',
  cathedral: 'christian',
  chapel: 'christian',
  basilica: 'christian',
  mosque: 'muslim',
  synagogue: 'jewish',
  temple: 'other',
  shrine: 'other',
};

/**
 * Faith of a place of worship from `religion`, `denomination` and `building`, or
 * undefined when the tags do not say (core then assumes a church). Orthodox
 * denominations (`russian_orthodox`, `greek_orthodox`, …) are a faith of their own:
 * their churches carry onion domes and three-barred crosses.
 */
export function faithOf(tags: Tags): Faith | undefined {
  const religion = tags.religion;
  if (religion === undefined) return BUILDING_FAITH[tags.building ?? ''];
  const faith = RELIGION_FAITH[religion] ?? 'other';
  if (faith === 'christian' && (tags.denomination ?? '').includes('orthodox')) return 'orthodox';
  return faith;
}

/** Other tags that mark a special building. */
export const SPECIAL_TAG: readonly { key: string; values?: readonly string[] }[] = [
  {
    key: 'man_made',
    values: ['tower', 'water_tower', 'chimney', 'lighthouse', 'silo', 'cooling_tower', 'storage_tank'],
  },
  {
    key: 'historic',
    values: ['castle', 'city_gate', 'tower', 'fort', 'monastery', 'church', 'ruins', 'citywalls'],
  },
  { key: 'leisure', values: ['stadium'] },
  { key: 'ruins', values: ['yes'] },
];

/** Node tags inside a footprint that mean a ground-floor shop front. */
export const SHOP_NODE_AMENITY: ReadonlySet<string> = new Set([
  'restaurant',
  'cafe',
  'fast_food',
  'bar',
  'pub',
  'ice_cream',
  'bank',
  'pharmacy',
  'bureau_de_change',
]);

/** True when the element should not become a building at all. */
export function skipReason(tags: Tags): string | undefined {
  const b = tags.building;
  if (b !== undefined && SKIP_BUILDING.has(b)) return `building=${b}`;
  if (tags.location === 'underground' || tags.location === 'underwater') return `location=${tags.location}`;
  return undefined;
}

function match(tags: Tags, rule: { key: string; values?: readonly string[] }): boolean {
  const v = tags[rule.key];
  if (v === undefined || v === 'no') return false;
  return rule.values ? rule.values.includes(v) : true;
}

/** `special` flag and the tag that caused it. */
export function specialReason(tags: Tags): string | undefined {
  const b = tags.building;
  if (b !== undefined && SPECIAL_BUILDING.has(b)) return `building=${b}`;
  for (const rule of SPECIAL_TAG) if (match(tags, rule)) return `${rule.key}=${tags[rule.key]}`;
  return undefined;
}

export interface Classification {
  type: BuildingType | undefined;
  reason: string;
  /** Set when a shop tag or node asks for a ground-floor store. */
  shop?: boolean;
}

export interface ClassifyContext {
  area: number;
  levels: number | undefined;
  /** Shop or shop-like amenity tag on the building or a node inside it, for the reason text. */
  shopSource: string | undefined;
  /** Touches at least two other buildings: part of a closed row. */
  denseRow: boolean;
}

/** Above this footprint a building with shops is a store, not a townhouse with a shop. */
const LARGE_STORE_AREA = 1500;
/** `building=residential` from this footprint or level count on is apartments. */
const RESIDENTIAL_APARTMENT_AREA = 250;
const RESIDENTIAL_APARTMENT_LEVELS = 4;

/** Picks the core building type for a (non-special) building. */
export function classify(tags: Tags, ctx: ClassifyContext): Classification {
  const b = tags.building ?? 'yes';
  const mapped = BUILDING_TYPE[b];
  const shopFlag = ctx.shopSource ? { shop: true } : {};
  if (mapped === RESIDENTIAL) {
    const big = ctx.area >= RESIDENTIAL_APARTMENT_AREA || (ctx.levels ?? 0) >= RESIDENTIAL_APARTMENT_LEVELS;
    return {
      type: big ? 'apartments' : 'house',
      reason: `building=residential, ${Math.round(ctx.area)} m², ${ctx.levels ?? '?'} levels`,
      ...shopFlag,
    };
  }
  if (mapped) return { type: mapped, reason: `building=${b}`, ...shopFlag };

  for (const rule of OTHER_TYPE) {
    if (match(tags, rule)) return { type: rule.type, reason: `${rule.key}=${tags[rule.key]}`, ...shopFlag };
  }

  if (ctx.shopSource) {
    if (ctx.area < LARGE_STORE_AREA && ((ctx.levels ?? 0) >= 3 || ctx.denseRow)) {
      const why = (ctx.levels ?? 0) >= 3 ? `${ctx.levels} levels` : 'dense row';
      return { type: 'townhouse', reason: `${ctx.shopSource}, ${why}`, shop: true };
    }
    return { type: 'store', reason: ctx.shopSource, shop: true };
  }
  return { type: undefined, reason: b === 'yes' ? 'no type tags' : `building=${b} (unmapped)` };
}
