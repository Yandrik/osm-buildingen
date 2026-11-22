import type { LatLonBBox } from '@osm-buildingen/osm';
import { OPENMAPTILES_LAYERS } from './build';
import { type DecodedTile, decodeTile } from './mvt';
import { type TileAddress, tilesForBBox } from './tile-math';

/*
 * Separate entry point (`@osm-buildingen/vector-tiles/fetch`): the only module
 * that touches the network. Uses `fetch`, so it works in browsers, workers and
 * Node 18+. PMTiles archives are not supported (see plan/adapters/vector-tiles.md).
 */

/** OpenFreeMap's TileJSON: OpenMapTiles schema, no key. Terms: https://openfreemap.org/tos/ */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
/** Attribution required for OpenMapTiles-schema tiles built from OpenStreetMap. */
export const OPENMAPTILES_ATTRIBUTION = '© OpenMapTiles © OpenStreetMap contributors';
/** Default cap on the number of tiles one call may fetch. */
export const DEFAULT_MAX_TILES = 36;

/** HTTP or decoding failure; `retryable` for rate limits and server errors. */
export class TileFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TileFetchError';
  }
}

/** The fields of a TileJSON document this package uses. */
export interface TileJson {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  attribution?: string;
}

export interface FetchTilesOptions {
  /** URL template with `{z}`, `{x}`, `{y}` (and optionally `{key}`). Either this or `tileJson`. */
  tileUrl?: string;
  /** TileJSON URL; its first `tiles` template is used and its `maxzoom` caps the zoom. */
  tileJson?: string;
  bbox: LatLonBBox;
  /** Default 14 (OpenMapTiles has buildings with heights from z14). Clamped to the TileJSON `maxzoom`. */
  zoom?: number;
  /** Replaces `{key}` in the URLs; appended as `key=` when there is no placeholder (MapTiler style). */
  apiKey?: string;
  signal?: AbortSignal;
  /** Refuse areas needing more tiles than this. Default 36. */
  maxTiles?: number;
  /** Requests in flight at once. Default 4 (OpenFreeMap's limit for bulk downloads). */
  concurrency?: number;
  /** Layers to decode; default the OpenMapTiles layers the adapter reads. */
  layers?: readonly string[];
  onProgress?: (done: number, total: number) => void;
}

export interface FetchTilesResult {
  tiles: DecodedTile[];
  zoom: number;
  /** The template the tiles came from, before the API key was added. */
  template: string;
  attribution: string | undefined;
  /** Compressed or uncompressed bytes as received by `fetch` (after Content-Encoding is undone). */
  bytes: number;
  /** Tiles the server did not have (404 / 204), returned as empty tiles. */
  missing: number;
}

function withKey(url: string, key: string | undefined): string {
  if (!key) return url.replace(/[?&]key=\{key\}/, '').replace('{key}', '');
  if (url.includes('{key}')) return url.replace('{key}', encodeURIComponent(key));
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
}

async function request(url: string, signal: AbortSignal | undefined, what: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TileFetchError(`${what}: network error (${String(error)})`, 0, true);
  }
  return response;
}

const failure = (what: string, status: number): TileFetchError =>
  new TileFetchError(
    `${what} failed with HTTP ${status}${status === 401 || status === 403 ? ' (API key missing or invalid?)' : ''}`,
    status,
    status === 429 || status >= 500,
  );

/** Loads a TileJSON document and resolves relative tile URLs against it. */
export async function fetchTileJson(
  url: string,
  options: { apiKey?: string; signal?: AbortSignal } = {},
): Promise<TileJson> {
  const full = withKey(url, options.apiKey);
  const response = await request(full, options.signal, 'TileJSON');
  if (!response.ok) throw failure('TileJSON', response.status);
  const json: unknown = await response.json();
  if (typeof json !== 'object' || json === null)
    throw new TileFetchError('TileJSON is not an object', 0, false);
  const j = json as Record<string, unknown>;
  const tiles = Array.isArray(j.tiles) ? j.tiles.filter((t): t is string => typeof t === 'string') : [];
  if (tiles.length === 0) throw new TileFetchError('TileJSON has no tile URLs', 0, false);
  const out: TileJson = {
    tiles: tiles.map((t) =>
      new URL(t, response.url || full).toString().replace(/%7B/gi, '{').replace(/%7D/gi, '}'),
    ),
    minzoom: typeof j.minzoom === 'number' ? j.minzoom : 0,
    maxzoom: typeof j.maxzoom === 'number' ? j.maxzoom : 22,
  };
  if (typeof j.attribution === 'string') out.attribution = j.attribution;
  return out;
}

/** Fills a `{z}/{x}/{y}` template. */
export function tileUrl(template: string, t: TileAddress): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Downloads and decodes the tiles covering `bbox`. Servers usually send tiles
 * with `Content-Encoding: gzip`, which `fetch` undoes; tiles that are still
 * gzip-compressed (static hosting without the header) are decompressed here.
 */
export async function fetchTiles(options: FetchTilesOptions): Promise<FetchTilesResult> {
  let template = options.tileUrl;
  let attribution: string | undefined;
  let zoom = options.zoom ?? 14;
  if (!template) {
    if (!options.tileJson) throw new TileFetchError('Either tileUrl or tileJson is required', 0, false);
    const tj = await fetchTileJson(options.tileJson, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    template = tj.tiles[0] as string;
    attribution = tj.attribution;
    zoom = Math.max(tj.minzoom, Math.min(tj.maxzoom, zoom));
  }
  const addresses = tilesForBBox(options.bbox, zoom);
  const maxTiles = options.maxTiles ?? DEFAULT_MAX_TILES;
  if (addresses.length > maxTiles) {
    throw new TileFetchError(
      `The area needs ${addresses.length} tiles at z${zoom}; the limit is ${maxTiles}.`,
      0,
      false,
    );
  }
  const layers = options.layers ?? Object.values(OPENMAPTILES_LAYERS);
  const tiles: DecodedTile[] = new Array(addresses.length);
  let bytes = 0;
  let missing = 0;
  let done = 0;
  let next = 0;
  const fullTemplate = withKey(template, options.apiKey);

  async function worker(): Promise<void> {
    while (next < addresses.length) {
      const i = next++;
      const t = addresses[i] as TileAddress;
      const what = `Tile ${t.z}/${t.x}/${t.y}`;
      const response = await request(tileUrl(fullTemplate, t), options.signal, what);
      if (response.status === 404 || response.status === 204) {
        missing++;
        tiles[i] = { ...t, layers: {} };
      } else if (!response.ok) {
        throw failure(what, response.status);
      } else {
        let data: Uint8Array<ArrayBuffer> = new Uint8Array(await response.arrayBuffer());
        bytes += data.length;
        if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) data = await gunzip(data);
        tiles[i] = decodeTile(data, t.z, t.x, t.y, { layers });
      }
      done++;
      options.onProgress?.(done, addresses.length);
    }
  }
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, addresses.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { tiles, zoom, template, attribution, bytes, missing };
}
