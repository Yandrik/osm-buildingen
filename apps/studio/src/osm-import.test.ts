import type { BuildingInput } from '@osm-buildingen/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ulm from '../../../packages/osm/test/fixtures/ulm-minster.osm?raw';
import {
  OverpassError,
  areaFromText,
  bboxAround,
  elementQuery,
  fetchArea,
  fetchElementExtent,
  findElement,
  inputForBuilding,
  parseLocation,
  polygonCentroid,
  searchBuildings,
} from './osm-import';
import { decodePermalinkHash, encodePermalinkHash, parseJsonInput } from './share';
import { parseInput } from './state';

const style = { region: 'us', modernity: 0.8 } as const;

describe('parseLocation', () => {
  it('reads coordinate pairs', () => {
    expect(parseLocation('48.3984, 9.9925')).toEqual({ kind: 'point', lat: 48.3984, lon: 9.9925 });
    expect(parseLocation(' 48.3984 9.9925 ')).toEqual({ kind: 'point', lat: 48.3984, lon: 9.9925 });
    expect(parseLocation('-33.9;18.4')).toEqual({ kind: 'point', lat: -33.9, lon: 18.4 });
    expect(parseLocation('95, 10')).toBeNull();
  });
  it('reads openstreetmap.org map URLs', () => {
    expect(parseLocation('https://www.openstreetmap.org/#map=19/48.39812/9.99126')).toEqual({
      kind: 'point',
      lat: 48.39812,
      lon: 9.99126,
    });
    expect(parseLocation('https://www.openstreetmap.org/?mlat=48.1&mlon=9.2#map=17/48.1/9.2')).toEqual({
      kind: 'point',
      lat: 48.1,
      lon: 9.2,
    });
  });
  it('reads element ids and URLs', () => {
    const way = { kind: 'element', osmType: 'way', id: 25697720 };
    expect(parseLocation('way/25697720')).toEqual(way);
    expect(parseLocation('https://www.openstreetmap.org/way/25697720')).toEqual(way);
    expect(parseLocation('https://www.openstreetmap.org/way/25697720#map=19/48.4/9.9')).toEqual(way);
    expect(parseLocation('w25697720')).toEqual(way);
    expect(parseLocation('relation/42')).toEqual({ kind: 'element', osmType: 'relation', id: 42 });
    expect(parseLocation('node/42')).toBeNull();
    expect(parseLocation('Ulm')).toBeNull();
  });
});

describe('queries', () => {
  it('builds a square box', () => {
    const b = bboxAround({ lat: 48, lon: 10 }, 120);
    expect(b.maxLat - b.minLat).toBeCloseTo((240 / 6371008.8) * (180 / Math.PI), 5);
    expect((b.maxLon - b.minLon) * Math.cos((48 * Math.PI) / 180)).toBeCloseTo(b.maxLat - b.minLat, 5);
  });
  it('locates an element with its nodes', () => {
    expect(elementQuery('way', 25697720)).toBe('[out:json][timeout:25];(way(25697720);>;);out skel qt;');
  });
});

describe('fetch with a mocked server', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns 504 into a retryable OverpassError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Gateway Timeout</html>', { status: 504 })),
    );
    const err = await fetchElementExtent('way', 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverpassError);
    expect((err as OverpassError).retryable).toBe(true);
    // fetchArea goes through fetchOverpass for points; same error class there.
    const err2 = await fetchArea({ query: { kind: 'point', lat: 48, lon: 10 }, radius: 50 }).catch(
      (e: unknown) => e,
    );
    expect(err2).toBeInstanceOf(OverpassError);
    expect((err2 as OverpassError).retryable).toBe(true);
  });

  it('treats 400 as not retryable and posts the query to the endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchElementExtent('relation', 7, { endpoint: 'https://example.test/api' }).catch(
      (e: unknown) => e,
    );
    expect((err as OverpassError).retryable).toBe(false);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/api');
    expect(String(fetchMock.mock.calls[0]?.[1].body)).toContain(encodeURIComponent('relation(7)'));
  });

  it('locates an element, then fetches its surroundings', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(decodeURIComponent(String(init.body)));
        if (bodies.length === 1) {
          return Response.json({
            elements: [
              { type: 'node', id: 1, lat: 48.0, lon: 10.0 },
              { type: 'node', id: 2, lat: 48.0002, lon: 10.0003 },
            ],
          });
        }
        const nodes = [
          [48.0, 10.0],
          [48.0, 10.0003],
          [48.0002, 10.0003],
          [48.0002, 10.0],
        ].map(([lat, lon], i) => ({ type: 'node', id: i + 1, lat, lon }));
        return Response.json({
          elements: [
            ...nodes,
            { type: 'way', id: 99, nodes: [1, 2, 3, 4, 1], tags: { building: 'house', name: 'Test' } },
          ],
        });
      }),
    );
    const area = await fetchArea({ query: { kind: 'element', osmType: 'way', id: 99 }, radius: 120 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('way["building"]');
    expect(area.focus).toBe(0);
    expect(area.result.meta[0]?.osmId).toBe(99);
  });
});

describe('sample fixture', () => {
  const area = areaFromText(ulm, 'ulm');

  it('loads the library re-centred, keeping seed and groupKey', () => {
    const i = findElement(area.result, 'way', 25697720);
    expect(i).not.toBeNull();
    const raw = area.result.inputs[i as number] as BuildingInput;
    const input = inputForBuilding(area.result, i as number, { style });
    const c = polygonCentroid(input.footprint);
    expect(Math.abs(c[0])).toBeLessThan(0.02);
    expect(Math.abs(c[1])).toBeLessThan(0.02);
    expect(input.seed).toBe(raw.seed);
    expect(input.groupKey).toBe(raw.groupKey);
    expect(input.style).toEqual(style);
    expect(input.roof?.shape).toBe('pyramidal');
    expect(input.height).toBe(35);
    expect(input.roads?.length).toBeGreaterThan(0);
    for (const p of input.footprint.outer) for (const v of p) expect(Math.round(v * 100) / 100).toBe(v);
  });

  it('finds buildings by name, address and id', () => {
    const i = findElement(area.result, 'way', 25697720);
    expect(searchBuildings(area.result, 'Zentralbibliothek')).toContain(i);
    expect(searchBuildings(area.result, '25697720')[0]).toBe(i);
  });

  it('round-trips an input with parts, neighbours and roads through the permalink', async () => {
    const i = findElement(area.result, 'way', 231142192) as number;
    const input: BuildingInput = {
      ...inputForBuilding(area.result, i, { style }),
      entrance: false,
      shopProbability: 0.3,
    };
    expect(input.parts?.length).toBe(11);
    const withExtras: BuildingInput = {
      ...input,
      neighbours: [
        ...(input.neighbours ?? []),
        {
          footprint: {
            outer: [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          },
          height: 9,
          minHeight: 4,
          sameGroup: true,
        },
      ],
      roads: [
        ...(input.roads ?? []),
        {
          line: [
            [0, -5],
            [5, -5],
          ],
          width: 4,
          kind: 'path',
          passage: true,
        },
      ],
    };
    const back = await decodePermalinkHash(await encodePermalinkHash(withExtras));
    expect(back).toEqual(JSON.parse(JSON.stringify(withExtras)));
  });

  it('validates field types', () => {
    const base = {
      footprint: {
        outer: [
          [0, 0],
          [5, 0],
          [5, 5],
        ],
      },
      style: { region: 'de', modernity: 0.5 },
      seed: 1,
    };
    expect('input' in parseInput({ ...base, entrance: false, shopProbability: 0.2 })).toBe(true);
    expect(parseInput({ ...base, entrance: 'no' })).toEqual({ error: 'entrance must be true or false.' });
    expect(
      'error' in
        parseInput({
          ...base,
          roads: [
            {
              line: [
                [0, 0],
                [1, 1],
              ],
              kind: 'lane',
            },
          ],
        }),
    ).toBe(true);
    expect(
      'error' in parseInput({ ...base, neighbours: [{ footprint: base.footprint, minHeight: '3' }] }),
    ).toBe(true);
    expect('error' in parseInput({ ...base, parts: [{ footprint: {} }] })).toBe(true);
    expect(() =>
      parseJsonInput(JSON.stringify({ ...base, parts: [{ footprint: base.footprint, height: 4 }] })),
    ).not.toThrow();
  });
});
