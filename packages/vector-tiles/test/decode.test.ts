import { describe, expect, it } from 'vitest';
import { PbfError, decodeTile, featurePolygons, levelsFromSchemaHeight } from '../src';
import {
  latToTileY,
  lonToTileX,
  tileBBox,
  tileXToLon,
  tileYToLat,
  tilesForBBox,
  unitSize,
} from '../src/tile-math';
import { encodeTile, rect } from './encode';

describe('decodeTile', () => {
  const bytes = encodeTile([
    {
      name: 'building',
      features: [
        {
          id: 12345678901,
          type: 'polygon',
          properties: { render_height: 15, render_min_height: 0, colour: '#aabbcc', hide_3d: true },
          // Exterior, its hole (negative area), then a second exterior.
          geometry: [rect(0, 0, 100, 100), rect(20, 20, 40, 40).reverse(), rect(200, 200, 260, 250)],
        },
      ],
    },
    {
      name: 'poi',
      extent: 512,
      features: [
        { type: 'point', properties: { class: 'shop', rank: -3, ele: 12.5 }, geometry: [[[10, 20]]] },
        {
          type: 'line',
          properties: { class: 'minor' },
          geometry: [
            [
              [-10, 5],
              [30, -7],
              [4100, 4000],
            ],
          ],
        },
      ],
    },
  ]);

  it('reads layers, extents, ids and every value type', () => {
    const tile = decodeTile(bytes, 14, 1, 2);
    expect(Object.keys(tile.layers).sort()).toEqual(['building', 'poi']);
    const b = tile.layers.building;
    expect(b?.extent).toBe(4096);
    expect(b?.version).toBe(2);
    const f = b?.features[0];
    expect(f?.id).toBe(12345678901);
    expect(f?.properties).toEqual({
      render_height: 15,
      render_min_height: 0,
      colour: '#aabbcc',
      hide_3d: true,
    });
    const poi = tile.layers.poi;
    expect(poi?.extent).toBe(512);
    expect(poi?.features[0]?.properties).toEqual({ class: 'shop', rank: -3, ele: 12.5 });
    expect(poi?.features[0]?.id).toBeUndefined();
  });

  it('decodes command geometry with negative deltas and points outside the extent', () => {
    const tile = decodeTile(bytes, 14, 1, 2);
    const [point, line] = tile.layers.poi?.features ?? [];
    expect(point?.type).toBe('point');
    expect(point?.geometry).toEqual([[[10, 20]]]);
    expect(line?.type).toBe('line');
    expect(line?.geometry).toEqual([
      [
        [-10, 5],
        [30, -7],
        [4100, 4000],
      ],
    ]);
  });

  it('groups polygon rings by signed area', () => {
    const f = decodeTile(bytes, 14, 1, 2).layers.building?.features[0];
    expect(f?.geometry).toHaveLength(3);
    const polys = f ? featurePolygons(f) : [];
    expect(polys).toHaveLength(2);
    expect(polys[0]?.holes).toHaveLength(1);
    expect(polys[1]?.holes).toHaveLength(0);
    expect(polys[1]?.outer).toEqual(rect(200, 200, 260, 250));
  });

  it('skips unwanted layers', () => {
    const tile = decodeTile(bytes, 14, 1, 2, { layers: ['poi'] });
    expect(Object.keys(tile.layers)).toEqual(['poi']);
  });

  it('rejects gzip and truncated data', () => {
    expect(() => decodeTile(new Uint8Array([0x1f, 0x8b, 8, 0]), 0, 0, 0)).toThrow(PbfError);
    expect(() => decodeTile(bytes.subarray(0, bytes.length - 5), 0, 0, 0)).toThrow(PbfError);
  });
});

describe('tile maths', () => {
  it('round-trips lat/lon and tile coordinates', () => {
    for (const [lat, lon] of [
      [48.3984, 9.9916],
      [-33.86, 151.21],
      [0, 0],
    ] as const) {
      expect(tileYToLat(latToTileY(lat, 14), 14)).toBeCloseTo(lat, 9);
      expect(tileXToLon(lonToTileX(lon, 14), 14)).toBeCloseTo(lon, 9);
    }
  });

  it('finds the Ulm centre tile and the tiles of a bbox', () => {
    expect(Math.floor(lonToTileX(9.9916, 14))).toBe(8646);
    expect(Math.floor(latToTileY(48.3984, 14))).toBe(5668);
    const tiles = tilesForBBox({ minLon: 9.98813, minLat: 48.39654, maxLon: 9.99593, maxLat: 48.40006 }, 14);
    expect(tiles).toEqual([
      { z: 14, x: 8646, y: 5667 },
      { z: 14, x: 8646, y: 5668 },
    ]);
    const b = tileBBox({ z: 14, x: 8646, y: 5668 });
    expect(b.minLat).toBeLessThan(48.3984);
    expect(b.maxLat).toBeGreaterThan(48.3984);
  });

  it('gives about 40 cm per tile unit at z14 in Ulm', () => {
    expect(unitSize(48.3984, 14)).toBeCloseTo(0.3962, 3);
    expect(unitSize(0, 14)).toBeCloseTo(0.5965, 3);
  });

  it('reads schema heights as levels', () => {
    expect(levelsFromSchemaHeight(11, 'ceil')).toBe(3);
    expect(levelsFromSchemaHeight(15, 'ceil')).toBe(4);
    expect(levelsFromSchemaHeight(12, 'ceil')).toBeUndefined();
    expect(levelsFromSchemaHeight(7, 'floor')).toBe(2);
  });
});
