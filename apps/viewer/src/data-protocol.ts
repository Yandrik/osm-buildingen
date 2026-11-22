/** Messages between `data.ts` (main thread) and `data-worker.ts`. Types only. */
import type { BuildOptions, BuildResult, LatLonBBox } from '@osm-buildingen/osm';

export type DataSource =
  | { kind: 'blob'; blob: Blob; name: string }
  | { kind: 'url'; url: string; name: string }
  | { kind: 'overpass'; bbox: LatLonBBox; endpoint: string };

export type DataRequest =
  | { kind: 'load'; id: number; source: DataSource }
  | { kind: 'abort'; id: number }
  | { kind: 'build'; id: number; options: BuildOptions };

export interface LoadSummary {
  name: string;
  format: 'xml' | 'json';
  bytes: number;
  nodes: number;
  ways: number;
  relations: number;
  bounds: LatLonBBox | undefined;
  /** Download or file read. */
  readMs: number;
  parseMs: number;
}

export type DataResponse =
  | { kind: 'progress'; id: number; message: string }
  | { kind: 'loaded'; id: number; summary: LoadSummary }
  | { kind: 'built'; id: number; result: BuildResult; ms: number }
  | { kind: 'error'; id: number; message: string; status?: number; retryable?: boolean };
