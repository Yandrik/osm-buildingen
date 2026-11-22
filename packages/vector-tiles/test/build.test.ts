import { type Vec2, generateBuilding } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { type DecodedTile, buildInputsFromTiles, decodeTile, tileYToLat, unitSize } from '../src';
import { type EncodeFeature, type EncodeLayer, encodeTile, rect } from './encode';

const style = { region: 'de', modernity: 0.3 } as const;
const Z = 14;
const X = 8646;
const Y = 5668;
const BUFFER = 64;

/** Clips an axis-aligned rectangle (tile units) to the tile plus buffer, like a tile generator does. */
function clipRect(x0: number, y0: number, x1: number, y1: number): [number, number][] | null {
  const c = (v: number): number => Math.max(-BUFFER, Math.min(4096 + BUFFER, v));
  const r = [c(x0), c(y0), c(x1), c(y1)] as const;
  if (r[2] <= r[0] || r[3] <= r[1]) return null;
  return rect(r[0], r[1], r[2], r[3]);
}

/** A tile with one building rectangle given in world units relative to tile (X, Y). */
function tileWith(
  dx: number,
  dy: number,
  buildings: { r: [number, number, number, number]; h?: number }[],
  extra: EncodeLayer[] = [],
): DecodedTile {
  const features: EncodeFeature[] = [];
  for (const { r, h } of buildings) {
    const ring = clipRect(r[0] - dx * 4096, r[1] - dy * 4096, r[2] - dx * 4096, r[3] - dy * 4096);
    if (ring)
      features.push({
        type: 'polygon',
        properties: { render_height: h ?? 11, render_min_height: 0 },
        geometry: [ring],
      });
  }
  return decodeTile(encodeTile([{ name: 'building', features }, ...extra]), Z, X + dx, Y + dy);
}

const area = (r: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as Vec2;
    const q = r[(i + 1) % r.length] as Vec2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

describe('projection and orientation', () => {
  const tile = tileWith(0, 0, [{ r: [100, 100, 200, 300] }]);
  const result = buildInputsFromTiles([tile], { style });
  const input = result.inputs[0];

  it('turns the y-down tile ring into a counter-clockwise ring in metres', () => {
    expect(result.inputs).toHaveLength(1);
    expect(area(input?.footprint.outer ?? [])).toBeGreaterThan(0);
  });

  it('scales by the ground size of a tile unit', () => {
    const lat = tileYToLat(Y + 0.5, Z);
    const u = unitSize(lat, Z);
    const xs = (input?.footprint.outer ?? []).map((p) => p[0]);
    const ys = (input?.footprint.outer ?? []).map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100 * u, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(200 * u, 1);
    expect(result.meta[0]?.area).toBeCloseTo(100 * 200 * u * u, -1);
  });

  it('puts small tile y north of large tile y', () => {
    // The building sits in the north-west of the tile, so north-west of the tile centre (the origin).
    expect(result.meta[0]?.centroid[0]).toBeLessThan(0);
    expect(result.meta[0]?.centroid[1]).toBeGreaterThan(0);
  });

  it('reads levels from the schema height', () => {
    expect(input?.levels).toBe(3);
    expect(input?.height).toBeUndefined();
    expect(result.meta[0]?.heightSource).toBe('levels');
  });
});

describe('stitching across tile borders', () => {
  // A 196 × 100 unit building crossing the border between (X, Y) and (X + 1, Y).
  const crossing: [number, number, number, number] = [4000, 1000, 4196, 1100];
  const a = tileWith(0, 0, [{ r: crossing }]);
  const b = tileWith(1, 0, [{ r: crossing }]);

  it('merges the pieces into one building', () => {
    const r = buildInputsFromTiles([a, b], { style });
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0]?.footprint.outer).toHaveLength(4);
    expect(r.meta[0]?.stitched).toBe(true);
    expect(r.meta[0]?.truncated).toBe(false);
    expect(r.meta[0]?.tiles).toEqual([`14/${X}/${Y}`, `14/${X + 1}/${Y}`]);
    const u = unitSize(tileYToLat(Y + 0.25, Z), Z);
    expect(r.meta[0]?.area).toBeCloseTo(196 * 100 * u * u, -1);
    expect(r.stats.stitched).toBe(1);
  });

  it('flags a building cut at the buffer when the neighbour is missing', () => {
    const r = buildInputsFromTiles([a], { style });
    expect(r.inputs).toHaveLength(1);
    expect(r.meta[0]?.truncated).toBe(true);
  });

  it('merges across a horizontal border and around four tiles', () => {
    const big: [number, number, number, number] = [4050, 4050, 4150, 4150];
    const tiles = [0, 1].flatMap((dx) => [0, 1].map((dy) => tileWith(dx, dy, [{ r: big }])));
    const r = buildInputsFromTiles(tiles, { style });
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0]?.footprint.outer).toHaveLength(4);
    expect(r.meta[0]?.tiles).toHaveLength(4);
  });

  it('keeps a courtyard that crosses the border', () => {
    const features = (dx: number): EncodeFeature[] => {
      const o = dx * 4096;
      const outer = clipRect(3900 - o, 1000 - o * 0, 4300 - o, 1400);
      const hole = clipRect(4000 - o, 1100, 4200 - o, 1300)?.reverse();
      return outer && hole
        ? [
            {
              type: 'polygon',
              properties: { render_height: 15, render_min_height: 0 },
              geometry: [outer, hole],
            },
          ]
        : [];
    };
    const tiles = [0, 1].map((dx) =>
      decodeTile(encodeTile([{ name: 'building', features: features(dx) }]), Z, X + dx, Y),
    );
    const r = buildInputsFromTiles(tiles, { style });
    expect(r.inputs).toHaveLength(1);
    expect(r.inputs[0]?.footprint.outer).toHaveLength(4);
    expect(r.inputs[0]?.footprint.holes).toHaveLength(1);
    expect(r.inputs[0]?.footprint.holes?.[0]).toHaveLength(4);
  });

  it('drops the copy of a building in the neighbour buffer', () => {
    // Entirely inside (X, Y), but within 64 units of the border: also in the buffer of (X + 1, Y).
    const near: [number, number, number, number] = [4040, 500, 4090, 560];
    const r = buildInputsFromTiles([tileWith(0, 0, [{ r: near }]), tileWith(1, 0, [{ r: near }])], { style });
    expect(r.inputs).toHaveLength(1);
    expect(r.meta[0]?.stitched).toBe(false);
  });

  it('does not merge touching buildings with different heights', () => {
    const left: [number, number, number, number] = [4000, 0, 4096, 50];
    const right: [number, number, number, number] = [4096, 0, 4200, 50];
    const tiles = [0, 1].map((dx) =>
      tileWith(dx, 0, [
        { r: left, h: 8 },
        { r: right, h: 15 },
      ]),
    );
    const r = buildInputsFromTiles(tiles, { style });
    expect(r.inputs).toHaveLength(2);
  });
});

describe('seeds and determinism', () => {
  // Reaches 34 units into (X + 1, Y): complete in the buffer of (X, Y) alone.
  const building: [number, number, number, number] = [4000, 2000, 4130, 2080];
  const a = tileWith(0, 0, [{ r: building }]);
  const b = tileWith(1, 0, [{ r: building }]);

  it('gives the same seed whether the building comes from one tile or is stitched from two', () => {
    const alone = buildInputsFromTiles([a], { style });
    const stitched = buildInputsFromTiles([a, b], { style });
    expect(alone.meta[0]?.truncated).toBe(false);
    expect(stitched.meta[0]?.stitched).toBe(true);
    expect(stitched.inputs[0]?.seed).toBe(alone.inputs[0]?.seed);
    expect(stitched.meta[0]?.key).toBe(alone.meta[0]?.key);
  });

  it('does not depend on the origin, tile order or the global seed key', () => {
    const one = buildInputsFromTiles([a, b], { style });
    const other = buildInputsFromTiles([b, a], { style, origin: { lat: 48.4, lon: 10 } });
    expect(other.inputs.map((i) => i.seed)).toEqual(one.inputs.map((i) => i.seed));
    const reseeded = buildInputsFromTiles([a, b], { style, seed: 'x' });
    expect(reseeded.inputs[0]?.seed).not.toBe(one.inputs[0]?.seed);
    expect(reseeded.meta[0]?.key).toBe(one.meta[0]?.key);
  });

  it('gives identical prefab houses at different places different seeds', () => {
    const r = buildInputsFromTiles(
      [tileWith(0, 0, [{ r: [100, 100, 130, 125] }, { r: [200, 100, 230, 125] }])],
      {
        style,
      },
    );
    expect(r.inputs).toHaveLength(2);
    expect(r.inputs[0]?.seed).not.toBe(r.inputs[1]?.seed);
  });
});

describe('attributes, parts, hints and roads', () => {
  const features: EncodeFeature[] = [
    // Outline of a type=building relation and its two parts.
    {
      type: 'polygon',
      properties: { render_height: 30, render_min_height: 0, hide_3d: true },
      geometry: [rect(1000, 1000, 1200, 1100)],
    },
    {
      type: 'polygon',
      properties: { render_height: 30, render_min_height: 0 },
      geometry: [rect(1000, 1000, 1100, 1100)],
    },
    {
      type: 'polygon',
      properties: { render_height: 12, render_min_height: 4, colour: '#ff0000' },
      geometry: [rect(1100, 1000, 1200, 1100)],
    },
    // A plain building with nothing tagged, and a shop.
    {
      type: 'polygon',
      properties: { render_height: 5, render_min_height: 0 },
      geometry: [rect(2000, 2000, 2060, 2040)],
    },
    // A building next to it (3 m gap), with an address.
    {
      type: 'polygon',
      properties: { render_height: 8, render_min_height: 0 },
      geometry: [rect(2065, 2000, 2100, 2040)],
    },
  ];
  const tile = decodeTile(
    encodeTile([
      { name: 'building', features },
      {
        name: 'poi',
        features: [
          { type: 'point', properties: { class: 'bakery', subclass: 'bakery' }, geometry: [[[2030, 2020]]] },
        ],
      },
      {
        name: 'housenumber',
        features: [{ type: 'point', properties: { housenumber: '7a' }, geometry: [[[2080, 2020]]] }],
      },
      {
        name: 'transportation',
        features: [
          {
            type: 'line',
            properties: { class: 'path', subclass: 'footway' },
            geometry: [
              [
                [1050, 900],
                [1050, 1200],
              ],
            ],
          },
          {
            type: 'line',
            properties: { class: 'minor', brunnel: 'bridge' },
            geometry: [
              [
                [1150, 900],
                [1150, 1200],
              ],
            ],
          },
          {
            type: 'line',
            properties: { class: 'minor' },
            geometry: [
              [
                [1900, 2050],
                [2200, 2050],
              ],
            ],
          },
        ],
      },
    ]),
    Z,
    X,
    Y,
  );
  const r = buildInputsFromTiles([tile], { style });
  const at = (x: number): number => r.meta.findIndex((m) => Math.abs(m.centroid[0] - x) < 5);
  const u = unitSize(tileYToLat(Y + 0.5, Z), Z);
  const localX = (px: number): number => (px - 2048) * u;

  it('attaches parts to a hide_3d outline', () => {
    const i = at(localX(1100));
    const input = r.inputs[i];
    expect(r.inputs).toHaveLength(3);
    expect(input?.parts).toHaveLength(2);
    const red = input?.parts?.find((p) => p.colours?.wall === '#ff0000');
    expect(red?.height).toBe(12);
    expect(red?.minHeight).toBe(4);
    expect(input?.parts?.find((p) => p !== red)?.levels).toBe(8);
  });

  it('leaves default heights to core and reads shop POIs and house numbers', () => {
    const shop = r.inputs[at(localX(2030))];
    const addressed = r.inputs[at(localX(2082))];
    expect(shop?.height).toBeUndefined();
    expect(shop?.levels).toBeUndefined();
    expect(shop?.shop).toBe(true);
    expect(addressed?.hasAddress).toBe(true);
    expect(addressed?.levels).toBe(2);
    expect(shop?.neighbours).toHaveLength(1);
    expect(shop?.groupKey).toBe(addressed?.groupKey);
  });

  it('marks paths through the footprint as passages, but not bridges', () => {
    const roads = r.inputs[at(localX(1100))]?.roads ?? [];
    expect(roads.filter((x) => x.passage)).toHaveLength(1);
    expect(roads.find((x) => x.passage)?.kind).toBe('path');
    expect(r.roads).toHaveLength(3);
  });

  it('produces inputs that core accepts', () => {
    for (const input of r.inputs) expect(generateBuilding(input).indices.length).toBeGreaterThan(0);
  });
});
