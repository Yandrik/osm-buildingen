/** The worker URL is in assets/, so resolve the app base against the origin, not the worker. */
const base = new URL(import.meta.env.BASE_URL, self.location.origin);
export const DATA = new URL(import.meta.env.VITE_SIM_DATA_URL || 'data/', base).href.replace(/\/$/, '');

/** Published snapshots are immutable; local development must still see edited tiles. */
export async function fetchDataJson(path: string): Promise<Response> {
  const compressed = import.meta.env.VITE_SIM_DATA_GZIP === 'true';
  const res = await fetch(`${DATA}/${path}${compressed ? '.gz' : ''}`, {
    cache: import.meta.env.VITE_SIM_DATA_IMMUTABLE === 'true' ? 'force-cache' : 'default',
  });
  if (!res.ok || !compressed || !res.body) return res;
  // Explicit .gz assets work even when the static host cannot set Content-Encoding.
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip')), {
    headers: { 'Content-Type': 'application/json' },
  });
}
