import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { generateBuilding } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { buildInputsFromTiles, decodeTile, tileBBox } from '../src';

// One real OpenFreeMap z14 tile of the Ulm centre (see fixtures/README.md).
const bytes = new Uint8Array(
  gunzipSync(readFileSync(new URL('./fixtures/14-8646-5668.pbf.gz', import.meta.url))),
);
const tile = decodeTile(bytes, 14, 8646, 5668);
const bbox = tileBBox(tile);
const result = buildInputsFromTiles([tile], { style: { region: 'de', modernity: 0.3 }, bbox });

describe('real OpenMapTiles tile (Ulm, 14/8646/5668)', () => {
  it('decodes the OpenMapTiles layers', () => {
    for (const name of ['building', 'transportation', 'housenumber', 'poi', 'landuse']) {
      expect(tile.layers[name]?.features.length ?? 0).toBeGreaterThan(0);
    }
    expect(tile.layers.building?.extent).toBe(4096);
  });

  it('finds the buildings with heights, addresses and shops', () => {
    expect(result.inputs.length).toBeGreaterThan(1000);
    const withLevels = result.inputs.filter((i) => i.levels !== undefined).length;
    expect(withLevels).toBeGreaterThan(200);
    expect(result.inputs.filter((i) => i.hasAddress).length).toBeGreaterThan(200);
    expect(result.inputs.filter((i) => i.shop).length).toBeGreaterThan(100);
    expect(result.meta.some((m) => m.special)).toBe(true);
    expect(result.meta.some((m) => m.parts > 0)).toBe(true);
  });

  it('produces inputs that core accepts, with distinct seeds', () => {
    for (const input of result.inputs) {
      expect(() => generateBuilding({ ...input, detail: 'massing' })).not.toThrow();
    }
    expect(new Set(result.inputs.map((i) => i.seed)).size).toBe(result.inputs.length);
  });
});
