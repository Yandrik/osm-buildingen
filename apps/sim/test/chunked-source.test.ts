import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkedSource } from '../src/world/chunked-source';

const fetchMock = vi.fn<typeof fetch>();
const bytes = Uint8Array.from({ length: 35 }, (_, i) => i);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url, options) => {
    const index = Number(String(url).match(/(\d+)\.bin$/)?.[1]);
    const range = new Headers(options?.headers).get('range') ?? '';
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range) ?? [];
    const start = index * 10 + Number(a);
    const end = Math.min(index * 10 + Number(b) + 1, bytes.length);
    return new Response(bytes.slice(start, end), {
      status: 206,
      headers: { ETag: `"segment-${index}"` },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('segmented static terrain archive', () => {
  it('reads a range within a segment', async () => {
    const source = new ChunkedSource('https://example.test/archive', 10, 35);
    expect(source.getKey()).toBe('https://example.test/archive');
    expect(new Uint8Array((await source.getBytes(12, 4)).data)).toEqual(bytes.slice(12, 16));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/archive/0001.bin');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('range')).toBe('bytes=2-5');
  });

  it('joins ranges spanning multiple segments without leaking segment etags', async () => {
    const result = await new ChunkedSource('https://example.test/archive', 10, 35).getBytes(8, 25);
    expect(new Uint8Array(result.data)).toEqual(bytes.slice(8, 33));
    expect(result.etag).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('clips header reads at the archive end', async () => {
    const result = await new ChunkedSource('https://example.test/archive', 10, 35).getBytes(0, 16384);
    expect(new Uint8Array(result.data)).toEqual(bytes);
  });

  it('passes cancellation to each request', async () => {
    const signal = new AbortController().signal;
    await new ChunkedSource('https://example.test/archive', 10, 35).getBytes(8, 5, signal);
    expect(fetchMock.mock.calls.every((call) => call[1]?.signal === signal)).toBe(true);
  });

  it('rejects truncated segments', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(1), { status: 206 }));
    await expect(new ChunkedSource('https://example.test/archive', 10, 35).getBytes(5, 5)).rejects.toThrow(
      'Truncated terrain segment',
    );
  });
});
