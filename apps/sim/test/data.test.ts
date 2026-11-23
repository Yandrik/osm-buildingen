import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('self', { location: { origin: 'https://example.test' } });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BASE_URL', '/paris-ride/');
  vi.stubEnv('VITE_SIM_DATA_URL', '');
  vi.stubEnv('VITE_SIM_DATA_GZIP', '');
  vi.stubEnv('VITE_SIM_DATA_IMMUTABLE', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('static deployment data', () => {
  it('resolves local data relative to the app, not its assets worker', async () => {
    const { DATA, fetchDataJson } = await import('../src/world/data');
    expect(DATA).toBe('https://example.test/paris-ride/data');
    fetchMock.mockResolvedValue(new Response('{"ok":true}'));
    expect(await (await fetchDataJson('osm/tiles/14/1/2.json')).json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/paris-ride/data/osm/tiles/14/1/2.json', {
      cache: 'default',
    });
  });

  it('decodes explicit gzip assets and reuses immutable snapshot cache', async () => {
    vi.stubEnv('VITE_SIM_DATA_URL', 'data/snapshot/');
    vi.stubEnv('VITE_SIM_DATA_GZIP', 'true');
    vi.stubEnv('VITE_SIM_DATA_IMMUTABLE', 'true');
    const { DATA, fetchDataJson } = await import('../src/world/data');
    expect(DATA).toBe('https://example.test/paris-ride/data/snapshot');
    fetchMock.mockResolvedValue(new Response(gzipSync('{"tiles":[[1,2]]}')));
    expect(await (await fetchDataJson('osm/buildings/index.json')).json()).toEqual({ tiles: [[1, 2]] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/paris-ride/data/snapshot/osm/buildings/index.json.gz',
      { cache: 'force-cache' },
    );
  });

  it('allows an explicit external data origin', async () => {
    vi.stubEnv('VITE_SIM_DATA_URL', 'https://data.example.test/snapshot/');
    const { DATA } = await import('../src/world/data');
    expect(DATA).toBe('https://data.example.test/snapshot');
  });

  it('preserves missing tile status rather than decompressing the error page', async () => {
    vi.stubEnv('VITE_SIM_DATA_GZIP', 'true');
    const missing = new Response('Not Found', { status: 404 });
    fetchMock.mockResolvedValue(missing);
    const { fetchDataJson } = await import('../src/world/data');
    expect(await fetchDataJson('osm/spill/14/1/2.json')).toBe(missing);
  });

  it('rejects a corrupt compressed tile instead of treating it as empty data', async () => {
    vi.stubEnv('VITE_SIM_DATA_GZIP', 'true');
    fetchMock.mockResolvedValue(new Response('not gzip'));
    const { fetchDataJson } = await import('../src/world/data');
    await expect((await fetchDataJson('osm/tiles/14/1/2.json')).json()).rejects.toThrow();
  });
});
