/**
 * Loading and input building, off the main thread. A newer request supersedes an
 * older one: superseded promises resolve to `null` and their results are ignored.
 */
import type { BuildOptions, BuildResult } from '@osm-buildingen/osm';
import type { DataRequest, DataResponse, DataSource, LoadSummary } from './data-protocol';

export type { DataSource, LoadSummary };

export class LoadError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LoadError';
  }
}

export interface BuildOutcome {
  result: BuildResult;
  /** `buildInputs` time inside the worker. */
  ms: number;
  /** Round trip including the structured clone of the result. */
  wallMs: number;
}

export interface DataClient {
  /** Resolves `null` when a newer load superseded this one. Rejects with `LoadError`. */
  load(source: DataSource): Promise<LoadSummary | null>;
  cancelLoad(): void;
  /** Resolves `null` when a newer build superseded this one. */
  build(options: BuildOptions): Promise<BuildOutcome | null>;
  dispose(): void;
}

interface Waiting {
  resolve: (r: DataResponse | null) => void;
}

export function createDataClient(onProgress: (message: string) => void): DataClient {
  const worker = new Worker(new URL('./data-worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  let loadId = 0;
  let buildId = 0;
  const waiting = new Map<number, Waiting>();

  worker.onmessage = (event: MessageEvent<DataResponse>): void => {
    const msg = event.data;
    if (msg.kind === 'progress') {
      if (msg.id === loadId) onProgress(msg.message);
      return;
    }
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    w.resolve(msg);
  };
  worker.onerror = (event: ErrorEvent): void => {
    const message = event.message || 'Data worker failed';
    for (const [id, w] of waiting) {
      w.resolve({ kind: 'error', id, message });
    }
    waiting.clear();
  };

  function request(message: DataRequest): Promise<DataResponse | null> {
    return new Promise((resolve) => {
      waiting.set(message.id, { resolve });
      worker.postMessage(message);
    });
  }

  /** Resolves the promise of a superseded request right away. */
  function supersede(id: number): void {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    w.resolve(null);
  }

  return {
    async load(source) {
      if (loadId) {
        worker.postMessage({ kind: 'abort', id: loadId } satisfies DataRequest);
        supersede(loadId);
      }
      const id = nextId++;
      loadId = id;
      const response = await request({ kind: 'load', id, source });
      if (!response || id !== loadId) return null;
      loadId = 0;
      if (response.kind === 'error') {
        throw new LoadError(response.message, response.status, response.retryable ?? false);
      }
      if (response.kind !== 'loaded') throw new LoadError('Unexpected worker response.', undefined, false);
      return response.summary;
    },
    cancelLoad() {
      if (!loadId) return;
      worker.postMessage({ kind: 'abort', id: loadId } satisfies DataRequest);
    },
    async build(options) {
      if (buildId) supersede(buildId);
      const id = nextId++;
      buildId = id;
      const t0 = performance.now();
      const response = await request({ kind: 'build', id, options });
      if (!response || id !== buildId) return null;
      if (response.kind === 'error') throw new Error(response.message);
      if (response.kind !== 'built') throw new Error('Unexpected worker response.');
      return { result: response.result, ms: response.ms, wallMs: performance.now() - t0 };
    },
    dispose() {
      worker.terminate();
      for (const id of [...waiting.keys()]) supersede(id);
    },
  };
}
