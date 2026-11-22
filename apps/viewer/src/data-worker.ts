/// <reference lib="webworker" />
/**
 * Data worker: downloads / reads, parses and runs `buildInputs`. It keeps the parsed
 * `OsmData` so a style or seed change only posts the build options, never the data.
 */
import { type OsmData, buildInputs, parseOsmXml, parseOverpassJson } from '@osm-buildingen/osm';
import { OverpassError, fetchOverpass } from '@osm-buildingen/osm/overpass';
import type { DataRequest, DataResponse, DataSource, LoadSummary } from './data-protocol';

declare const self: DedicatedWorkerGlobalScope;

let data: OsmData | null = null;
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
  source: Exclude<DataSource, { kind: 'overpass' }>,
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
      const next = await fetchOverpass(source.bbox, { endpoint: source.endpoint, signal: controller.signal });
      // fetchOverpass parses internally; the split between download and parse is not visible.
      const t1 = performance.now();
      data = next;
      summary = describe(next, 'Overpass', 'json', 0, t1 - t0, 0);
    } else {
      post({ kind: 'progress', id, message: `Reading ${source.name}…` });
      const text = await readSource(source, controller.signal);
      const t1 = performance.now();
      post({ kind: 'progress', id, message: `Parsing ${(text.length / 1e6).toFixed(1)} MB…` });
      const format = detectFormat(source.name, text);
      const next = format === 'json' ? parseOverpassJson(JSON.parse(text)) : parseOsmXml(text);
      const t2 = performance.now();
      data = next;
      summary = describe(next, source.name, format, text.length, t1 - t0, t2 - t1);
    }
    post({ kind: 'loaded', id, summary });
  } catch (error) {
    if (error instanceof OverpassError) {
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
    const result = buildInputs(data, request.options);
    post({ kind: 'built', id: request.id, result, ms: performance.now() - t0 });
  } catch (error) {
    post({ kind: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<DataRequest>): void => {
  const request = event.data;
  if (request.kind === 'load') void load(request.id, request.source);
  else if (request.kind === 'abort') aborts.get(request.id)?.abort();
  else {
    // Deferred so that requests arriving during a running build collapse into the newest one.
    const idle = pendingBuild === null;
    pendingBuild = request;
    if (idle) setTimeout(runPendingBuild, 0);
  }
};
