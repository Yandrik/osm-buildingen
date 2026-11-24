/// <reference lib="webworker" />
/**
 * Data worker: downloads / reads, parses and runs `buildInputs` (OSM) or
 * `buildInputsFromTiles` (vector tiles). It keeps the parsed data so a style or
 * seed change only posts the build options, never the data.
 */
import {
  type LatLon,
  type LatLonBBox,
  type OsmData,
  buildInputs,
  createProjection,
  parseOsmXml,
  parseOverpassJson,
} from '@osm-buildingen/osm';
import { OverpassError, fetchOverpass } from '@osm-buildingen/osm/overpass';
import { type DecodedTile, OPENMAPTILES_LAYERS, buildInputsFromTiles } from '@osm-buildingen/vector-tiles';
import { TileFetchError, fetchTiles } from '@osm-buildingen/vector-tiles/fetch';
import type { AreaBuild } from './area-build';
import type { DataRequest, DataResponse, DataSource, LoadSummary } from './data-protocol';
import { type Rect, osmTrees, tileTrees } from './trees';

declare const self: DedicatedWorkerGlobalScope;

let data: { kind: 'osm'; osm: OsmData } | { kind: 'tiles'; tiles: DecodedTile[] } | null = null;
const aborts = new Map<number, AbortController>();
/** Only the newest build request runs; older ones queued behind a running build are dropped. */
let pendingBuild: Extract<DataRequest, { kind: 'build' }> | null = null;

const post = (message: DataResponse): void => self.postMessage(message);

function detectFormat(name: string, text: string): 'xml' | 'json' {
  if (/\.json$/i.test(name)) return 'json';
  if (/\.(osm|xml)$/i.test(name)) return 'xml';
  return text.trimStart().startsWith('{') ? 'json' : 'xml';
}

async function readSource(
  source: Extract<DataSource, { kind: 'blob' | 'url' }>,
  signal: AbortSignal,
): Promise<string> {
  if (source.kind === 'blob') return source.blob.text();
  const response = await fetch(source.url, { signal });
  if (!response.ok) throw new Error(`Could not load ${source.name} (${response.status}).`);
  return response.text();
}

async function load(id: number, source: DataSource): Promise<void> {
  const controller = new AbortController();
  aborts.set(id, controller);
  try {
    const t0 = performance.now();
    let summary: LoadSummary;
    if (source.kind === 'overpass') {
      post({ kind: 'progress', id, message: 'Waiting for Overpass…' });
      // Trees are always fetched so the "trees" toggle works without a reload.
      const next = await fetchOverpass(source.bbox, {
        endpoint: source.endpoint,
        signal: controller.signal,
        trees: true,
      });
      // fetchOverpass parses internally; the split between download and parse is not visible.
      const t1 = performance.now();
      data = { kind: 'osm', osm: next };
      summary = describe(next, 'Overpass', 'json', 0, t1 - t0, 0);
    } else if (source.kind === 'tiles') {
      post({ kind: 'progress', id, message: 'Loading vector tiles…' });
      const isTemplate = source.url.includes('{z}');
      const result = await fetchTiles({
        ...(isTemplate ? { tileUrl: source.url } : { tileJson: source.url }),
        bbox: source.bbox,
        zoom: source.zoom,
        signal: controller.signal,
        layers: [...Object.values(OPENMAPTILES_LAYERS), 'landcover'],
        ...(source.apiKey ? { apiKey: source.apiKey } : {}),
        onProgress: (done, total) =>
          post({ kind: 'progress', id, message: `Vector tiles ${done} / ${total}…` }),
      });
      data = { kind: 'tiles', tiles: result.tiles };
      // Download and decoding are interleaved; the total is reported as read time.
      summary = {
        name: new URL(source.url.replace(/[{}]/g, '_')).host,
        format: 'mvt',
        bytes: result.bytes,
        nodes: 0,
        ways: 0,
        relations: 0,
        tiles: { count: result.tiles.length, zoom: result.zoom, missing: result.missing },
        bounds: source.bbox,
        readMs: performance.now() - t0,
        parseMs: 0,
      };
    } else {
      post({ kind: 'progress', id, message: `Reading ${source.name}…` });
      const text = await readSource(source, controller.signal);
      const t1 = performance.now();
      post({ kind: 'progress', id, message: `Parsing ${(text.length / 1e6).toFixed(1)} MB…` });
      const format = detectFormat(source.name, text);
      const next = format === 'json' ? parseOverpassJson(JSON.parse(text)) : parseOsmXml(text);
      const t2 = performance.now();
      data = { kind: 'osm', osm: next };
      summary = describe(next, source.name, format, text.length, t1 - t0, t2 - t1);
    }
    post({ kind: 'loaded', id, summary });
  } catch (error) {
    if (error instanceof OverpassError || error instanceof TileFetchError) {
      post({ kind: 'error', id, message: error.message, status: error.status, retryable: error.retryable });
    } else if (controller.signal.aborted) {
      post({ kind: 'error', id, message: 'Cancelled.' });
    } else {
      post({ kind: 'error', id, message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    aborts.delete(id);
  }
}

function describe(
  d: OsmData,
  name: string,
  format: 'xml' | 'json',
  bytes: number,
  readMs: number,
  parseMs: number,
): LoadSummary {
  return {
    name,
    format,
    bytes,
    nodes: d.nodes.length,
    ways: d.ways.length,
    relations: d.relations.length,
    bounds: d.bounds,
    readMs,
    parseMs,
  };
}

function runPendingBuild(): void {
  const request = pendingBuild;
  pendingBuild = null;
  if (!request) return;
  if (!data) {
    post({ kind: 'error', id: request.id, message: 'No data loaded.' });
    return;
  }
  try {
    const t0 = performance.now();
    const result: AreaBuild =
      data.kind === 'osm'
        ? { source: 'osm', ...buildInputs(data.osm, request.options) }
        : { source: 'tiles', ...buildInputsFromTiles(data.tiles, request.options) };
    post({ kind: 'built', id: request.id, result, ms: performance.now() - t0 });
  } catch (error) {
    post({ kind: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

function trees(id: number, origin: LatLon, clip: LatLonBBox | undefined): void {
  if (!data) {
    post({ kind: 'error', id, message: 'No data loaded.' });
    return;
  }
  try {
    const t0 = performance.now();
    const proj = createProjection(origin);
    const box = clip ?? (data.kind === 'osm' ? data.osm.bounds : undefined);
    let rect: Rect | undefined;
    if (box) {
      const [minX, minY] = proj.project(box.minLat, box.minLon);
      const [maxX, maxY] = proj.project(box.maxLat, box.maxLon);
      rect = { minX, minY, maxX, maxY };
    }
    const result = data.kind === 'osm' ? osmTrees(data.osm, proj, rect) : tileTrees(data.tiles, proj, rect);
    self.postMessage(
      { kind: 'trees', id, trees: result, ms: performance.now() - t0 } satisfies DataResponse,
      [result.points.buffer],
    );
  } catch (error) {
    post({ kind: 'error', id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<DataRequest>): void => {
  const request = event.data;
  if (request.kind === 'load') void load(request.id, request.source);
  else if (request.kind === 'abort') aborts.get(request.id)?.abort();
  else if (request.kind === 'trees') trees(request.id, request.origin, request.clip);
  else {
    // Deferred so that requests arriving during a running build collapse into the newest one.
    const idle = pendingBuild === null;
    pendingBuild = request;
    if (idle) setTimeout(runPendingBuild, 0);
  }
};
