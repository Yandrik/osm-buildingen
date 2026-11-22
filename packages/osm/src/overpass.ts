import { SHOP_NODE_AMENITY } from './classify';
import { parseOverpassJson } from './overpass-json';
import type { LatLonBBox, OsmData } from './types';

/*
 * Separate entry point (`@osm-buildingen/osm/overpass`): the only module that
 * touches the network.
 */

export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface FetchOverpassOptions {
  endpoint?: string;
  signal?: AbortSignal;
  /** Server-side timeout in seconds. Default 60. */
  timeout?: number;
}

/** Error from the Overpass server; `retryable` is true for rate limits, timeouts and "server busy". */
export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

/**
 * Overpass QL for everything the adapter uses inside a bbox: buildings and
 * parts (ways and relations), highways, railways, and nodes with addresses or
 * shops; then all member ways and nodes (`>`), so geometry is complete.
 */
export function overpassQuery(bbox: LatLonBBox, timeout = 60): string {
  const b = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return [
    `[out:json][timeout:${Math.round(timeout)}];`,
    '(',
    `  way["building"](${b});`,
    `  way["building:part"](${b});`,
    `  relation["building"](${b});`,
    `  relation["building:part"](${b});`,
    `  relation["type"="building"](${b});`,
    `  way["highway"](${b});`,
    `  way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"](${b});`,
    `  node["addr:housenumber"](${b});`,
    `  node["shop"](${b});`,
    `  node["amenity"~"^(${[...SHOP_NODE_AMENITY].join('|')})$"](${b});`,
    ');',
    'out body;',
    '>;',
    'out skel qt;',
  ].join('\n');
}

/**
 * Downloads OSM data for a bbox from an Overpass server. Uses `fetch`, so it
 * works in browsers, workers and Node 18+. Throws `OverpassError` with a
 * readable message for 429 (rate limit), 504 (timeout / busy) and other errors.
 */
export async function fetchOverpass(bbox: LatLonBBox, options: FetchOverpassOptions = {}): Promise<OsmData> {
  const endpoint = options.endpoint ?? DEFAULT_OVERPASS_ENDPOINT;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(bbox, options.timeout))}`,
  };
  if (options.signal) init.signal = options.signal;
  const response = await fetch(endpoint, init);
  const text = await response.text();
  if (!response.ok) {
    const status = response.status;
    if (status === 429) {
      throw new OverpassError(
        'Overpass rate limit reached (429). Wait a minute or use another endpoint.',
        status,
        true,
      );
    }
    if (status === 504 || status === 503) {
      throw new OverpassError(
        `Overpass server is busy or timed out (${status}). Try again later or use a smaller area.`,
        status,
        true,
      );
    }
    throw new OverpassError(`Overpass request failed (${status}): ${summary(text)}`, status, false);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Overpass answers some runtime errors (e.g. "runtime error: Query timed out") with 200 and HTML.
    const busy = /timed out|too busy|rate_limited|out of memory/i.test(text);
    throw new OverpassError(
      busy
        ? `Overpass could not finish the query: ${summary(text)}`
        : `Overpass returned no JSON: ${summary(text)}`,
      response.status,
      busy,
    );
  }
  if (typeof json === 'object' && json !== null && 'remark' in json) {
    const remark = (json as { remark: unknown }).remark;
    if (typeof remark === 'string' && /runtime error|timed out|out of memory/i.test(remark)) {
      throw new OverpassError(`Overpass could not finish the query: ${remark}`, response.status, true);
    }
  }
  return parseOverpassJson(json);
}

function summary(text: string): string {
  const plain = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain || '(empty response)';
}

export type { LatLonBBox, OsmData };
