import type { BuildingType } from '@osm-buildingen/core';

/*
 * Type hints from the OpenMapTiles `poi` and `landuse` layers. The tiles carry
 * no `building=*` value, so these are the only type information. A POI inside a
 * footprint may be the building's own tag or a tenant (an office in a house), so
 * only POIs that usually describe the whole building set a type; shops only set
 * `shop` (like shop nodes in the OSM adapter).
 *
 * Order (see `classifyVector`): special > worship > station > POI type > landuse type >
 * shop (townhouse or store) > undefined (core guesses from size).
 */

/** POI `class` values that make a building special (massing, type left to core). */
export const SPECIAL_POI_CLASS: ReadonlySet<string> = new Set(['castle']);
/** POI `class` values that make a building a place of worship (type `worship`), from the same size. */
export const WORSHIP_POI_CLASS: ReadonlySet<string> = new Set(['place_of_worship']);
/**
 * Specials and places of worship need a footprint of at least this many m² (a chapel
 * room inside a hospital is not a church).
 */
export const SPECIAL_MIN_AREA = 80;

/** POI `class` / `subclass` -> type when the POI usually is the whole building. Key: `class/subclass` or `class`. */
export const POI_TYPE: Readonly<Record<string, BuildingType>> = {
  'railway/station': 'station',
  'railway/halt': 'station',
  'bus/bus_station': 'station',
  'harbor/ferry_terminal': 'station',
  town_hall: 'office',
  'college/university': 'office',
  'college/college': 'office',
  school: 'office',
  hospital: 'office',
  'library/library': 'office',
  'lodging/hotel': 'apartments',
  'lodging/hostel': 'apartments',
  'lodging/guest_house': 'apartments',
};

/**
 * POI classes that mean a shop or a shop-like ground floor (sets `shop`). OpenMapTiles
 * folds many `shop=*` values into own classes (clothing_store, grocery, bakery, …).
 */
export const SHOP_POI_CLASS: ReadonlySet<string> = new Set([
  'shop',
  'clothing_store',
  'grocery',
  'alcohol_shop',
  'beer',
  'bakery',
  'butcher',
  'hairdresser',
  'jewelry',
  'florist',
  'furniture',
  'optician',
  'pharmacy',
  'mobile_phone',
  'shoes',
  'books',
  'music',
  'car',
  'restaurant',
  'cafe',
  'fast_food',
  'bar',
  'pub',
  'ice_cream',
  'bank',
  'laundry',
]);

/** Landuse `class` -> type, only for footprints of at least `minArea` m² (a shed in an industrial area stays a shed). */
export const LANDUSE_TYPE: Readonly<Record<string, { type: BuildingType; minArea: number }>> = {
  industrial: { type: 'industrial', minArea: 150 },
  retail: { type: 'store', minArea: 300 },
  commercial: { type: 'office', minArea: 300 },
  school: { type: 'office', minArea: 200 },
  university: { type: 'office', minArea: 200 },
  college: { type: 'office', minArea: 200 },
  hospital: { type: 'office', minArea: 200 },
  garages: { type: 'garage', minArea: 0 },
};
/** Garage landuse only types small footprints. */
export const GARAGE_MAX_AREA = 120;

/** Townhouse-with-shop rule from the OSM adapter: larger footprints are stores. */
const SHOP_TOWNHOUSE_MAX_AREA = 1500;
const SHOP_TOWNHOUSE_MIN_LEVELS = 3;
/** Same threshold in metres when only a height is known. */
const SHOP_TOWNHOUSE_MIN_HEIGHT = 10;

export interface PoiHit {
  cls: string;
  subclass: string;
}

export interface ClassifyContext {
  area: number;
  pois: readonly PoiHit[];
  /** Class of the smallest landuse polygon containing the footprint's interior point. */
  landuse: string | undefined;
  levels: number | undefined;
  height: number | undefined;
  /** The building touches at least two others (dense row). */
  denseRow: boolean;
}

export interface Classification {
  type: BuildingType | undefined;
  reason: string;
  special: string | undefined;
  shop: boolean;
}

/** Type decision for one building from the hints around it. */
export function classifyVector(c: ClassifyContext): Classification {
  const pois = c.pois
    .slice()
    .sort((a, b) => a.cls.localeCompare(b.cls) || a.subclass.localeCompare(b.subclass));
  if (c.area >= SPECIAL_MIN_AREA) {
    const special = pois.find((p) => SPECIAL_POI_CLASS.has(p.cls));
    if (special) {
      const what = `poi ${special.cls}/${special.subclass}`;
      return { type: undefined, reason: `special: ${what}`, special: what, shop: false };
    }
    const worship = pois.find((p) => WORSHIP_POI_CLASS.has(p.cls));
    if (worship) {
      return {
        type: 'worship',
        reason: `poi ${worship.cls}/${worship.subclass}`,
        special: undefined,
        shop: false,
      };
    }
  }
  const typed = pois
    .map((p) => ({ p, type: POI_TYPE[`${p.cls}/${p.subclass}`] ?? POI_TYPE[p.cls] }))
    .filter((x): x is { p: PoiHit; type: BuildingType } => x.type !== undefined)
    // Stations first: a kiosk inside a station must not turn it into a store.
    .sort((a, b) => Number(b.type === 'station') - Number(a.type === 'station'));
  const first = typed[0];
  if (first) {
    return {
      type: first.type,
      reason: `poi ${first.p.cls}/${first.p.subclass}`,
      special: undefined,
      shop: false,
    };
  }
  const shopPoi = pois.find((p) => SHOP_POI_CLASS.has(p.cls));
  const land = c.landuse !== undefined ? LANDUSE_TYPE[c.landuse] : undefined;
  if (land && c.area >= land.minArea && !(land.type === 'garage' && c.area > GARAGE_MAX_AREA)) {
    return { type: land.type, reason: `landuse ${c.landuse}`, special: undefined, shop: Boolean(shopPoi) };
  }
  if (shopPoi) {
    const tall =
      (c.levels !== undefined && c.levels >= SHOP_TOWNHOUSE_MIN_LEVELS) ||
      (c.height !== undefined && c.height >= SHOP_TOWNHOUSE_MIN_HEIGHT);
    const what = `poi ${shopPoi.cls}/${shopPoi.subclass}`;
    if ((tall || c.denseRow) && c.area < SHOP_TOWNHOUSE_MAX_AREA) {
      return {
        type: 'townhouse',
        reason: `${what}, ${tall ? 'tall' : 'dense row'}`,
        special: undefined,
        shop: true,
      };
    }
    return { type: 'store', reason: what, special: undefined, shop: true };
  }
  return { type: undefined, reason: 'no hint', special: undefined, shop: false };
}
