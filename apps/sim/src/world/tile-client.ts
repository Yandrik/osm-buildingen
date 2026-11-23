import type { TileRequest, TileResponse } from './tile-protocol';

type Body<K extends TileRequest['kind']> = Omit<Extract<TileRequest, { kind: K }>, 'id'>;
type Reply<K extends TileRequest['kind']> = Extract<TileResponse, { kind: K }>;

/**
 * A few tile workers. Requests for one tile always go to the same worker, so its
 * parsed OSM data and decoded terrain stay cached there between terrain, paint and
 * detail requests.
 */
export class TileClient {
  private readonly workers: { worker: Worker; busy: number }[];
  private readonly pending = new Map<
    number,
    { resolve: (r: TileResponse) => void; reject: (e: Error) => void; slot: number }
  >();
  private nextId = 1;

  constructor(count: number) {
    this.workers = Array.from({ length: count }, (_, slot) => {
      const worker = new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<TileResponse>): void => {
        const job = this.pending.get(event.data.id);
        if (!job) return;
        this.pending.delete(event.data.id);
        (this.workers[slot] as { busy: number }).busy--;
        if (event.data.kind === 'error') job.reject(new Error(event.data.message));
        else job.resolve(event.data);
      };
      return { worker, busy: 0 };
    });
  }

  /** Requests in flight on the worker that owns this tile. */
  load(tx: number, ty: number): number {
    return (this.workers[this.slot(tx, ty)] as { busy: number }).busy;
  }

  get busy(): number {
    return this.workers.reduce((s, w) => s + w.busy, 0);
  }

  request<K extends TileRequest['kind']>(
    body: Body<K> & { kind: K },
    tx: number,
    ty: number,
  ): Promise<Reply<K>> {
    const slot = this.slot(tx, ty);
    const entry = this.workers[slot] as { worker: Worker; busy: number };
    const id = this.nextId++;
    entry.busy++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: TileResponse) => void, reject, slot });
      entry.worker.postMessage({ ...body, id });
    });
  }

  private slot(tx: number, ty: number): number {
    return (((tx * 73856093) ^ (ty * 19349663)) >>> 0) % this.workers.length;
  }
}
