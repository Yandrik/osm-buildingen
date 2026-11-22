/**
 * OSM import: data loading and query logic for the "From OSM…" dialog. The only place
 * that wires `@osm-buildingen/osm` into the studio. No DOM here (fetch is the only
 * browser API used), so the parsing and query helpers are unit-tested in Node.
 */
import type {
  BuildingInput,
  NeighbourInput,
  PartInput,
  Polygon,
  StyleInput,
  Vec2,
} from '@osm-buildingen/core';
import {
  type BuildResult,
  type BuildingMeta,
  type LatLon,
  type LatLonBBox,
  type OsmData,
  type OsmElementType,
  buildInputs,
  parseOsmXml,
  parseOverpassJson,
} from '@osm-buildingen/osm';
import { DEFAULT_OVERPASS_ENDPOINT, OverpassError, fetchOverpass } from '@osm-buildingen/osm/overpass';
import type { InputSource } from './state';

export { DEFAULT_OVERPASS_ENDPOINT, OverpassError };
export type { BuildResult, BuildingMeta, OsmData, OsmElementType };

export const DEFAULT_RADIUS = 120;
export const MAX_RADIUS = 400;
const EARTH_RADIUS = 6371008.8;

/**
 * Style used for the picker's `buildInputs` call. The adapter only copies it into each
 * input; the studio replaces it with its own style when a building is loaded.
 */
const PICKER_STYLE: StyleInput = { region: 'de', modernity: 0.5 };

// ---------------------------------------------------------------------------
// Location text: "lat, lon", openstreetmap.org URLs, element ids
// ---------------------------------------------------------------------------

export type LocationQuery =
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'element'; osmType: OsmElementType; id: number };

/**
 * Understands `48.3984, 9.9925` (comma, semicolon or space separated), osm.org URLs
 * with `#map=zoom/lat/lon` or `?mlat=..&mlon=..`, `way/25697720`, `relation/123`,
 * `w25697720` / `r123` and `https://www.openstreetmap.org/way/25697720`.
 * Returns null when the text is none of these.
 */
export function parseLocation(text: string): LocationQuery | null {
  const t = text.trim();
  if (!t) return null;
  // An element path wins over a #map fragment: osm.org/way/1#map=19/.. is about the way.
  const element = /(?:^|\/)(way|relation)\/(\d+)(?:$|[/?#])/i.exec(t) ?? /^(w|r)(\d+)$/i.exec(t);
  if (element) {
    const word = (element[1] as string).toLowerCase();
    const id = Number(element[2]);
    if (Number.isSafeInteger(id) && id > 0) {
      return { kind: 'element', osmType: word.startsWith('w') ? 'way' : 'relation', id };
    }
  }
  const map = /#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(t);
  if (map) return point(Number(map[1]), Number(map[2]));
  const marker = /[?&]mlat=(-?\d+(?:\.\d+)?)&mlon=(-?\d+(?:\.\d+)?)/.exec(t);
  if (marker) return point(Number(marker[1]), Number(marker[2]));
  const pair = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(t);
  if (pair) return point(Number(pair[1]), Number(pair[2]));
  return null;
}

function point(lat: number, lon: number): LocationQuery | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return { kind: 'point', lat, lon };
}

export function clampRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return DEFAULT_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(10, radius));
}

/** Square box of half-width `radius` metres around a point. */
export function bboxAround(centre: LatLon, radius: number): LatLonBBox {
  const dLat = (radius / EARTH_RADIUS) * (180 / Math.PI);
  const dLon = dLat / Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180));
  const r = (v: number): number => Number(v.toFixed(6));
  return {
    minLat: r(centre.lat - dLat),
    minLon: r(centre.lon - dLon),
    maxLat: r(centre.lat + dLat),
    maxLon: r(centre.lon + dLon),
  };
}

/** Overpass QL for one way or relation and its nodes, just to locate it. */
export function elementQuery(osmType: OsmElementType, id: number, timeout = 25): string {
  return `[out:json][timeout:${Math.round(timeout)}];(${osmType}(${id});>;);out skel qt;`;
}

export interface ElementExtent {
  centre: LatLon;
  /** Half the diagonal of the element's lat/lon box, metres. */
  radius: number;
}

/** Centre of the node box of a parsed element query; null when it returned no nodes. */
export function elementExtent(data: OsmData): ElementExtent | null {
  if (data.nodes.length === 0) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const n of data.nodes) {
    minLat = Math.min(minLat, n.lat);
    maxLat = Math.max(maxLat, n.lat);
    minLon = Math.min(minLon, n.lon);
    maxLon = Math.max(maxLon, n.lon);
  }
  const centre = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
  const k = (Math.PI / 180) * EARTH_RADIUS;
  const dy = (maxLat - minLat) * k;
  const dx = (maxLon - minLon) * k * Math.cos((centre.lat * Math.PI) / 180);
  return { centre, radius: Math.hypot(dx, dy) / 2 };
}

export interface FetchOptions {
  endpoint?: string;
  signal?: AbortSignal;
}

/**
 * Locates a way or relation through Overpass. `fetchOverpass` only takes a bbox, so
 * this posts its own small query; errors mirror `fetchOverpass` (`OverpassError`).
 */
export async function fetchElementExtent(
  osmType: OsmElementType,
  id: number,
  options: FetchOptions = {},
): Promise<ElementExtent> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(elementQuery(osmType, id))}`,
  };
  if (options.signal) init.signal = options.signal;
  const response = await fetch(options.endpoint || DEFAULT_OVERPASS_ENDPOINT, init);
  const text = await response.text();
  if (!response.ok) {
    const status = response.status;
    // 502 too: the public servers answer it while restarting or overloaded.
    const retryable = status === 429 || status === 502 || status === 503 || status === 504;
    throw new OverpassError(
      retryable
        ? `Overpass server is busy (${status}). Try again in a minute or use another endpoint.`
        : `Overpass request failed (${status}).`,
      status,
      retryable,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const busy = /timed out|too busy|rate_limited|out of memory/i.test(text);
    throw new OverpassError(
      busy ? 'Overpass could not finish the query (server busy).' : 'Overpass returned no JSON.',
      response.status,
      busy,
    );
  }
  const extent = elementExtent(parseOverpassJson(json));
  if (!extent) throw new Error(`${osmType} ${id} was not found on the Overpass server.`);
  return extent;
}

// ---------------------------------------------------------------------------
// Loading an area
// ---------------------------------------------------------------------------

/** A loaded area with the adapter's result, ready for the picker. */
export interface OsmArea {
  /** Human-readable source, e.g. "ulm-minster.osm" or "120 m around 48.39840, 9.99250". */
  label: string;
  data: OsmData;
  result: BuildResult;
  /** Index into `result.inputs` to preselect (set when the area was loaded for an element). */
  focus: number | null;
}

/** Parses `.osm` XML or Overpass JSON text (decided by the first character). */
export function parseOsmText(text: string): OsmData {
  const start = text.trimStart();
  if (start.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(start);
    } catch (e) {
      throw new Error(`Not valid JSON: ${(e as Error).message}`);
    }
    return parseOverpassJson(json);
  }
  return parseOsmXml(text);
}

export function areaFromData(data: OsmData, label: string, bbox?: LatLonBBox): OsmArea {
  const options: Parameters<typeof buildInputs>[1] = { style: PICKER_STYLE };
  if (bbox) {
    options.bbox = bbox;
    options.origin = { lat: (bbox.minLat + bbox.maxLat) / 2, lon: (bbox.minLon + bbox.maxLon) / 2 };
  }
  const result = buildInputs(data, options);
  if (result.inputs.length === 0) throw new Error(`No buildings found in ${label}.`);
  return { label, data, result, focus: null };
}

export function areaFromText(text: string, label: string): OsmArea {
  return areaFromData(parseOsmText(text), label);
}

export interface LocationRequest extends FetchOptions {
  query: LocationQuery;
  radius: number;
  /** Progress text for the UI. */
  onStep?: (step: string) => void;
}

/** Downloads the area for a point or around an element (two requests for elements). */
export async function fetchArea(request: LocationRequest): Promise<OsmArea> {
  const { query } = request;
  let radius = clampRadius(request.radius);
  let centre: LatLon;
  let label: string;
  if (query.kind === 'element') {
    request.onStep?.(`Locating ${query.osmType} ${query.id}…`);
    const extent = await fetchElementExtent(query.osmType, query.id, request);
    centre = extent.centre;
    // Big elements need a bigger box so their neighbours are included.
    radius = clampRadius(Math.max(radius, extent.radius + 40));
    label = `${query.osmType} ${query.id} (${Math.round(radius)} m)`;
  } else {
    centre = { lat: query.lat, lon: query.lon };
    label = `${Math.round(radius)} m around ${query.lat.toFixed(5)}, ${query.lon.toFixed(5)}`;
  }
  const bbox = bboxAround(centre, radius);
  request.onStep?.('Downloading buildings and roads…');
  const fetchOptions: FetchOptions = {};
  if (request.endpoint) fetchOptions.endpoint = request.endpoint;
  if (request.signal) fetchOptions.signal = request.signal;
  const data = await fetchOverpass(bbox, fetchOptions);
  request.onStep?.('Building inputs…');
  const area = areaFromData(data, label, bbox);
  if (query.kind === 'element') area.focus = findElement(area.result, query.osmType, query.id);
  return area;
}

export function findElement(result: BuildResult, osmType: OsmElementType, id: number): number | null {
  const i = result.meta.findIndex((m) => m.osmType === osmType && m.osmId === id);
  return i >= 0 ? i : null;
}

// ---------------------------------------------------------------------------
// Picking a building
// ---------------------------------------------------------------------------

/** Display name: `name`, else street + number, else type + id. */
export function buildingLabel(meta: BuildingMeta): string {
  const name = meta.tags.name;
  if (name) return name;
  const addr = addressOf(meta);
  return (
    addr || `${meta.tags.building === 'yes' ? 'building' : (meta.tags.building ?? 'building')} ${meta.osmId}`
  );
}

export function addressOf(meta: BuildingMeta): string {
  const t = meta.tags;
  return [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
}

/** Indices of buildings matching a search text (name, address or OSM id), best first. */
export function searchBuildings(result: BuildResult, text: string, limit = 200): number[] {
  const q = text.trim().toLowerCase();
  const all = result.meta.map((_, i) => i);
  if (!q) return all.filter((i) => isNotable(result.meta[i] as BuildingMeta)).slice(0, limit);
  const scored: [number, number][] = [];
  result.meta.forEach((m, i) => {
    const id = String(m.osmId);
    const name = (m.tags.name ?? '').toLowerCase();
    const addr = addressOf(m).toLowerCase();
    let score = -1;
    if (id === q || `${m.osmType}/${id}` === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (addr.startsWith(q)) score = 3;
    else if (addr.includes(q)) score = 4;
    else if (id.startsWith(q)) score = 5;
    if (score >= 0) scored.push([score, i]);
  });
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return scored.slice(0, limit).map(([, i]) => i);
}

/** With an empty search the list shows named buildings first. */
const isNotable = (m: BuildingMeta): boolean => Boolean(m.tags.name);

/** Tags worth showing in the summary, in this order. */
export const SUMMARY_TAGS = [
  'building',
  'building:part',
  'name',
  'addr:street',
  'addr:housenumber',
  'height',
  'min_height',
  'building:levels',
  'building:min_level',
  'roof:shape',
  'roof:height',
  'roof:levels',
  'roof:direction',
  'roof:orientation',
  'building:colour',
  'roof:colour',
  'start_date',
  'shop',
  'amenity',
  'tourism',
  'historic',
  'man_made',
] as const;

export function groupMembers(result: BuildResult, index: number): number[] {
  const key = result.meta[index]?.groupKey;
  if (key === undefined) return [];
  const out: number[] = [];
  result.meta.forEach((m, i) => {
    if (i !== index && m.groupKey === key) out.push(i);
  });
  return out;
}

export function sourceOf(meta: BuildingMeta): InputSource {
  return {
    osmType: meta.osmType,
    osmId: meta.osmId,
    ring: meta.ring,
    label: buildingLabel(meta),
    url: `https://www.openstreetmap.org/${meta.osmType}/${meta.osmId}`,
  };
}

export interface LoadOptions {
  /** Studio style; replaces the picker style. */
  style: StyleInput;
  /** Keep neighbours with `sameGroup` (default true). */
  groupNeighbours?: boolean;
}

/** The selected building's input, re-centred on its footprint centroid, in the studio's style. */
export function inputForBuilding(result: BuildResult, index: number, options: LoadOptions): BuildingInput {
  const input = result.inputs[index];
  const meta = result.meta[index];
  if (!input || !meta) throw new Error(`No building ${index} in the loaded area.`);
  const { neighbours, ...rest } = recentre(input, polygonCentroid(input.footprint));
  const out: BuildingInput = { ...rest, style: { ...options.style } };
  const kept = options.groupNeighbours === false ? neighbours?.filter((n) => !n.sameGroup) : neighbours;
  if (kept?.length) out.neighbours = kept;
  return out;
}

/** Area centroid of a polygon (holes subtracted); vertex mean for degenerate rings. */
export function polygonCentroid(polygon: Polygon): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of [polygon.outer, ...(polygon.holes ?? [])]) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as Vec2;
      const q = ring[(i + 1) % ring.length] as Vec2;
      const cross = p[0] * q[1] - q[0] * p[1];
      a += cross;
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
  }
  // Holes are clockwise, so their signed area already subtracts.
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(polygon.outer.length, 1);
    return [polygon.outer.reduce((s, p) => s + p[0], 0) / n, polygon.outer.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

const cm = (v: number): number => Math.round(v * 100) / 100 || 0;

/** Translates footprint, parts, neighbours and roads by -origin, rounded to 1 cm. */
export function recentre(input: BuildingInput, origin: Vec2): BuildingInput {
  const move = (ring: readonly Vec2[]): Vec2[] =>
    ring.map(([x, y]) => [cm(x - origin[0]), cm(y - origin[1])]);
  const poly = (p: Polygon): Polygon => {
    const out: Polygon = { outer: move(p.outer) };
    if (p.holes?.length) out.holes = p.holes.map(move);
    return out;
  };
  const out: BuildingInput = { ...input, footprint: poly(input.footprint) };
  if (input.parts) out.parts = input.parts.map((p): PartInput => ({ ...p, footprint: poly(p.footprint) }));
  if (input.neighbours) {
    out.neighbours = input.neighbours.map((n): NeighbourInput => ({ ...n, footprint: poly(n.footprint) }));
  }
  if (input.roads) out.roads = input.roads.map((r) => ({ ...r, line: move(r.line) }));
  return out;
}
