/** Parsing of the area fields (bounding box, centre + radius). Pure functions. */
import type { LatLonBBox } from '@osm-buildingen/osm';

const METRES_PER_DEGREE = 111_320;
/** Larger requests are refused: the public Overpass server would time out anyway. */
export const MAX_AREA_KM2 = 25;

export type AreaResult = { bbox: LatLonBBox } | { error: string };

function numbers(text: string): number[] | null {
  const parts = text
    .trim()
    .replace(/^bbox\s*=\s*/i, '')
    .split(/[\s,;]+/)
    .filter((p) => p !== '');
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function check(bbox: LatLonBBox): AreaResult {
  const { minLat, minLon, maxLat, maxLon } = bbox;
  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180)
    return { error: 'Coordinates out of range.' };
  if (minLat >= maxLat || minLon >= maxLon) return { error: 'Min must be smaller than max.' };
  const km2 = areaKm2(bbox);
  if (km2 > MAX_AREA_KM2)
    return { error: `Area is ${km2.toFixed(1)} km²; the limit is ${MAX_AREA_KM2} km².` };
  return { bbox };
}

/**
 * Reads "min lon, min lat, max lon, max lat", also as `bbox=…` (the openstreetmap.org
 * export / Overpass Turbo CSV form). Separators: comma, semicolon or whitespace.
 */
export function parseBBox(text: string): AreaResult {
  const v = numbers(text);
  if (!v || v.length !== 4) return { error: 'Expected four numbers: min lon, min lat, max lon, max lat.' };
  const [minLon, minLat, maxLon, maxLat] = v as [number, number, number, number];
  return check({ minLat, minLon, maxLat, maxLon });
}

/** Reads "lat, lon" and makes a square box with half-edge `radius` metres. */
export function parseCentre(text: string, radius: number): AreaResult {
  const v = numbers(text);
  if (!v || v.length !== 2) return { error: 'Expected the centre as "lat, lon".' };
  const [lat, lon] = v as [number, number];
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return { error: 'Centre out of range.' };
  if (!(radius > 0)) return { error: 'Radius must be positive.' };
  const dLat = radius / METRES_PER_DEGREE;
  const dLon = radius / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return check({ minLat: lat - dLat, minLon: lon - dLon, maxLat: lat + dLat, maxLon: lon + dLon });
}

export function areaKm2(b: LatLonBBox): number {
  const midLat = ((b.minLat + b.maxLat) / 2) * (Math.PI / 180);
  const h = (b.maxLat - b.minLat) * METRES_PER_DEGREE;
  const w = (b.maxLon - b.minLon) * METRES_PER_DEGREE * Math.cos(midLat);
  return (h * w) / 1e6;
}

export const formatBBox = (b: LatLonBBox): string =>
  [b.minLon, b.minLat, b.maxLon, b.maxLat].map((n) => n.toFixed(5)).join(',');
