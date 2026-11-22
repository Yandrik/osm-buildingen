import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TileFetchError, fetchTiles } from '../src/fetch';
import { encodeTile, rect } from './encode';

const tile = encodeTile([
  {
    name: 'building',
    features: [{ type: 'polygon', properties: { render_height: 8 }, geometry: [rect(0, 0, 10, 10)] }],
  },
  { name: 'water', features: [{ type: 'polygon', geometry: [rect(0, 0, 10, 10)] }] },
]);
const bbox = { minLon: 9.98813, minLat: 48.39654, maxLon: 9.99593, maxLat: 48.40006 };

function stub(handler: (url: string) => Response): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    const r = handler(url);
    Object.defineProperty(r, 'url', { value: url });
    return r;
  });
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchTiles', () => {
  it('resolves the TileJSON, clamps the zoom and decodes gzip without a header', async () => {
    const urls = stub((url) => {
      if (url.startsWith('https://example.test/tiles.json')) {
        return Response.json({ tiles: ['v1/{z}/{x}/{y}.pbf?key={key}'], maxzoom: 14, attribution: 'x' });
      }
      if (url.includes('/5667.')) return new Response(null, { status: 404 });
      return new Response(gzipSync(tile));
    });
    const r = await fetchTiles({
      tileJson: 'https://example.test/tiles.json?key={key}',
      bbox,
      zoom: 16,
      apiKey: 'k',
    });
    expect(r.zoom).toBe(14);
    expect(r.attribution).toBe('x');
    expect(r.missing).toBe(1);
    expect(r.tiles.map((t) => `${t.x}/${t.y}`)).toEqual(['8646/5667', '8646/5668']);
    expect(Object.keys(r.tiles[1]?.layers ?? {})).toEqual(['building']);
    expect(urls[0]).toBe('https://example.test/tiles.json?key=k');
    expect(urls).toContain('https://example.test/v1/14/8646/5668.pbf?key=k');
  });

  it('refuses areas above the tile cap and reports HTTP errors', async () => {
    stub(() => new Response(null, { status: 503 }));
    await expect(fetchTiles({ tileUrl: 'https://t.test/{z}/{x}/{y}', bbox, maxTiles: 1 })).rejects.toThrow(
      /limit/,
    );
    const error = await fetchTiles({ tileUrl: 'https://t.test/{z}/{x}/{y}', bbox }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TileFetchError);
    expect((error as TileFetchError).retryable).toBe(true);
  });
});
