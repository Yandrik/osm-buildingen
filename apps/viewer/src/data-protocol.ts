/** Messages between `data.ts` (main thread) and `data-worker.ts`. Types only. */
import type { BuildOptions, LatLonBBox } from '@osm-buildingen/osm';
import type { AreaBuild } from './area-build';

export type DataSource =
  | { kind: 'blob'; blob: Blob; name: string }
  | { kind: 'url'; url: string; name: string }
  | { kind: 'overpass'; bbox: LatLonBBox; endpoint: string }
  /** OpenMapTiles-schema vector tiles; `url` is a TileJSON URL or a `{z}/{x}/{y}` template. */
  | { kind: 'tiles'; bbox: LatLonBBox; url: string; apiKey: string; zoom: number };

export type DataRequest =
  | { kind: 'load'; id: number; source: DataSource }
  | { kind: 'abort'; id: number }
  /** The same options serve both adapters (origin, style, bbox, seed, shopProbability). */
  | { kind: 'build'; id: number; options: BuildOptions };

export interface LoadSummary {
  name: string;
  format: 'xml' | 'json' | 'mvt';
  bytes: number;
  nodes: number;
  ways: number;
  relations: number;
  /** Vector tiles only: tile count, zoom and tiles the server did not have. */
  tiles?: { count: number; zoom: number; missing: number };
  bounds: LatLonBBox | undefined;
  /** Download or file read. */
  readMs: number;
  parseMs: number;
}

export type DataResponse =
  | { kind: 'progress'; id: number; message: string }
  | { kind: 'loaded'; id: number; summary: LoadSummary }
  | { kind: 'built'; id: number; result: AreaBuild; ms: number }
  | { kind: 'error'; id: number; message: string; status?: number; retryable?: boolean };
