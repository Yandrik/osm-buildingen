import { readFileSync } from 'node:fs';
import { type BuildingInput, Rng, type Vec2 } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import {
  type BuildResult,
  type OsmData,
  ROAD_DISTANCE,
  buildInputs,
  parseOsmXml,
  project,
  unproject,
} from '../src';
import { signedArea } from '../src/geometry';

const style = { region: 'de', modernity: 0.3 } as const;
const data = parseOsmXml(readFileSync(new URL('./fixtures/ulm-minster.osm', import.meta.url), 'utf8'));
const result = buildInputs(data, { style });

const MINSTER = 25697707;
const LIBRARY = 25697720;
const STADTHAUS = 231142192;

function find(r: BuildResult, osmId: number, osmType = 'way'): { input: BuildingInput; index: number } {
  const index = r.meta.findIndex((m) => m.osmId === osmId && m.osmType === osmType);
  if (index < 0) throw new Error(`no input for ${osmType} ${osmId}`);
  return { input: r.inputs[index] as BuildingInput, index };
}

const keyOf = (r: BuildResult, i: number): string => {
  const m = r.meta[i];
  return `${m?.osmType}/${m?.osmId}/${m?.ring}`;
};

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('projection', () => {
  it('round-trips and has metre scale', () => {
    const origin = { lat: 48.398, lon: 9.992 };
    const p = project({ lat: 48.399, lon: 9.993 }, origin);
    expect(p[1]).toBeCloseTo(111.195, 2);
    expect(p[0]).toBeCloseTo(111.195 * Math.cos((48.398 * Math.PI) / 180), 2);
    const back = unproject(p, origin);
    expect(back.lat).toBeCloseTo(48.399, 10);
    expect(back.lon).toBeCloseTo(9.993, 10);
  });
});

describe('buildInputs on the Ulm fixture', () => {
  it('emits every building way and multipolygon ring, with matching meta', () => {
    expect(result.inputs.length).toBe(result.meta.length);
    expect(result.meta.filter((m) => m.osmType === 'way')).toHaveLength(613);
    expect(result.meta.filter((m) => m.osmType === 'relation')).toHaveLength(5);
    expect(result.stats.orphanParts).toBe(0);
    expect(result.origin).toEqual({ lat: (48.396543 + 48.400058) / 2, lon: (9.988128 + 9.995933) / 2 });
  });

  it('produces open, counter-clockwise rings in local metres', () => {
    for (const input of result.inputs) {
      const outer = input.footprint.outer;
      expect(outer.length).toBeGreaterThanOrEqual(3);
      const first = outer[0] as Vec2;
      const last = outer[outer.length - 1] as Vec2;
      expect(first[0] === last[0] && first[1] === last[1]).toBe(false);
      expect(signedArea(outer)).toBeGreaterThan(0);
      for (const h of input.footprint.holes ?? []) expect(signedArea(h)).toBeLessThan(0);
      // The fixture spans ~600 m x 400 m around the origin.
      for (const p of outer) expect(Math.abs(p[0]) + Math.abs(p[1])).toBeLessThan(1000);
    }
  });

  it('reads the library tags', () => {
    const { input, index } = find(result, LIBRARY);
    expect(input.roof).toMatchObject({ shape: 'pyramidal', height: 20, levels: 5, colour: 'blue' });
    expect(input.height).toBe(35);
    expect(input.levels).toBe(3);
    expect(input.colours).toEqual({ wall: 'blue' });
    expect(input.year).toBe(2004);
    expect(input.hasAddress).toBe(true);
    expect(input.type).toBe('office');
    expect(result.meta[index]?.typeReason).toBe('amenity=library');
    expect(result.meta[index]?.special).toBe(false);
  });

  it('marks the Minster special and attaches its parts', () => {
    const { input, index } = find(result, MINSTER);
    const meta = result.meta[index];
    expect(meta?.special).toBe(true);
    expect(input.detail).toBe('massing');
    expect(input.parts?.length).toBe(61);
    expect(meta?.partIds).toHaveLength(61);
    expect(input.colours?.wall).toBe('#A0A0A0');
    // The spire part is the tallest.
    const tallest = Math.max(...(input.parts ?? []).map((p) => p.height ?? 0));
    expect(tallest).toBeGreaterThan(150);
    for (const p of input.parts ?? []) expect(signedArea(p.footprint.outer)).toBeGreaterThan(0);
  });

  it('attaches the Stadthaus parts', () => {
    const { input, index } = find(result, STADTHAUS);
    expect(input.parts).toHaveLength(11);
    expect(input.type).toBe('office');
    expect(input.year).toBe(1993);
    expect(result.meta[index]?.special).toBe(false);
    // building:min_level=1 on one part is passed as minLevel, not converted to metres.
    expect(input.parts?.some((p) => p.minLevel === 1 && p.minHeight === undefined)).toBe(true);
  });

  it('turns multipolygon inner rings into holes', () => {
    const withHoles = result.inputs.filter(
      (i, k) => i.footprint.holes && result.meta[k]?.osmType === 'relation',
    );
    expect(withHoles.length).toBeGreaterThanOrEqual(3);
    const { input, index } = find(result, 3009440, 'relation');
    expect(input.footprint.holes).toHaveLength(1);
    const outerArea = signedArea(input.footprint.outer);
    const holeArea = -signedArea(input.footprint.holes?.[0] ?? []);
    expect(result.meta[index]?.area).toBeCloseTo(outerArea - holeArea, 6);
  });

  it('gives buildings in a dense row their neighbours', () => {
    // Münsterplatz 38, in the closed row on the north side of the square.
    const { input } = find(result, 256332736);
    expect(input.neighbours?.length).toBeGreaterThanOrEqual(4);
    // Neighbours in the row carry heights derived from their levels.
    expect(input.neighbours?.some((n) => n.height !== undefined)).toBe(true);
    for (const n of result.inputs.flatMap((i) => i.neighbours ?? [])) {
      expect(n.footprint.outer.length).toBeGreaterThanOrEqual(3);
    }
    expect(Math.max(...result.inputs.map((i) => i.neighbours?.length ?? 0))).toBeLessThanOrEqual(16);
  });

  it('attaches short road pieces near each building', () => {
    const withRoads = result.inputs.filter((i) => (i.roads?.length ?? 0) > 0);
    expect(withRoads.length / result.inputs.length).toBeGreaterThan(0.9);
    for (const input of result.inputs) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const [x, y] of input.footprint.outer) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      expect(input.roads?.length ?? 0).toBeLessThanOrEqual(12);
      for (const road of input.roads ?? []) {
        expect(road.line.length).toBeGreaterThanOrEqual(2);
        expect(road.width).toBeGreaterThan(0);
        for (const [x, y] of road.line) {
          expect(x).toBeGreaterThanOrEqual(minX - ROAD_DISTANCE - 1e-6);
          expect(x).toBeLessThanOrEqual(maxX + ROAD_DISTANCE + 1e-6);
          expect(y).toBeGreaterThanOrEqual(minY - ROAD_DISTANCE - 1e-6);
          expect(y).toBeLessThanOrEqual(maxY + ROAD_DISTANCE + 1e-6);
        }
      }
    }
    const kinds = new Set(result.roads.map((r) => r.kind));
    expect(kinds.has('road') && kinds.has('path')).toBe(true);
  });

  it('groups addressed buildings with their unaddressed outbuildings only', () => {
    const groups = new Map<string, number[]>();
    result.meta.forEach((m, i) => {
      groups.set(m.groupKey, [...(groups.get(m.groupKey) ?? []), i]);
    });
    for (const members of groups.values()) {
      const addressed = members.filter((i) => result.inputs[i]?.hasAddress).length;
      expect(addressed).toBeLessThanOrEqual(1);
    }
    expect(groups.size).toBeLessThan(result.inputs.length);
    for (const [i, input] of result.inputs.entries()) expect(input.groupKey).toBe(result.meta[i]?.groupKey);
  });

  it('is fast', () => {
    const t = performance.now();
    buildInputs(data, { style });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('determinism', () => {
  it('gives the same result for shuffled element order', () => {
    const rng = new Rng(7);
    const shuffledData: OsmData = {
      ...(data.bounds ? { bounds: data.bounds } : {}),
      nodes: shuffled(data.nodes, rng),
      ways: shuffled(data.ways, rng),
      relations: shuffled(data.relations, rng),
    };
    const again = buildInputs(shuffledData, { style });
    expect(again.meta.map((_, i) => keyOf(again, i))).toEqual(result.meta.map((_, i) => keyOf(result, i)));
    expect(again.inputs).toEqual(result.inputs);
  });

  it('keeps seeds and group keys when the origin moves', () => {
    const moved = buildInputs(data, { style, origin: { lat: 48.41, lon: 9.97 } });
    expect(moved.inputs.map((i) => i.seed)).toEqual(result.inputs.map((i) => i.seed));
    expect(moved.inputs.map((i) => i.groupKey)).toEqual(result.inputs.map((i) => i.groupKey));
    // Coordinates do move.
    expect(moved.inputs[0]?.footprint.outer[0]).not.toEqual(result.inputs[0]?.footprint.outer[0]);
  });

  it('keeps seeds for a building in a differently cut extract', () => {
    // Cut: keep only ways with a node in the western half (plus their nodes), as an API export would.
    const nodes = new Map(data.nodes.map((n) => [n.id, n]));
    const midLon = (9.988128 + 9.995933) / 2;
    const ways = data.ways.filter((w) => w.nodes.some((id) => (nodes.get(id)?.lon ?? 99) < midLon));
    const used = new Set(ways.flatMap((w) => w.nodes));
    const cut: OsmData = {
      nodes: data.nodes.filter((n) => used.has(n.id)),
      ways,
      relations: data.relations,
    };
    const part = buildInputs(cut, { style, origin: { lat: 48.398, lon: 9.99 } });
    const seeds = new Map(result.meta.map((_, i) => [keyOf(result, i), result.inputs[i]?.seed]));
    expect(part.inputs.length).toBeGreaterThan(100);
    expect(part.inputs.length).toBeLessThan(result.inputs.length);
    for (const [i, input] of part.inputs.entries()) expect(input.seed).toBe(seeds.get(keyOf(part, i)));
  });

  it('mixes the global seed into every building seed', () => {
    const other = buildInputs(data, { style, seed: 'another town' });
    const same = other.inputs.filter((x, i) => x.seed === result.inputs[i]?.seed);
    expect(same).toHaveLength(0);
  });
});

describe('small hand-made scene', () => {
  // Origin at 0,0 so a metre offset is easy to write in degrees.
  const M = 1 / 111195;
  const node = (id: number, x: number, y: number, tags?: Record<string, string>) => ({
    id,
    lat: y * M,
    lon: x * M,
    ...(tags ? { tags } : {}),
  });
  const scene: OsmData = {
    nodes: [
      // House 10 x 8 at (0,0)
      node(1, 0, 0),
      node(2, 10, 0),
      node(3, 10, 8),
      node(4, 0, 8),
      // Garage 4 m east of the house, unaddressed
      node(5, 14, 0),
      node(6, 18, 0),
      node(7, 18, 5),
      node(8, 14, 5),
      // Second house touching the garage, addressed
      node(9, 18, 0),
      node(10, 28, 0),
      node(11, 28, 8),
      node(12, 18, 8),
      // Address node inside the first house, shop node inside the second
      node(20, 5, 4, { 'addr:housenumber': '1' }),
      node(21, 23, 4, { shop: 'bakery' }),
      // Road along y = -5, footway through house 1
      node(30, -100, -5),
      node(31, 100, -5),
      node(32, 5, -3),
      node(33, 5, 12),
    ],
    ways: [
      { id: 100, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes' } },
      { id: 101, nodes: [5, 6, 7, 8, 5], tags: { building: 'garage' } },
      { id: 102, nodes: [9, 10, 11, 12, 9], tags: { building: 'yes', 'addr:housenumber': '3' } },
      { id: 103, nodes: [30, 31], tags: { highway: 'residential' } },
      { id: 104, nodes: [32, 33], tags: { highway: 'footway' } },
      { id: 105, nodes: [1, 2, 3, 1], tags: { building: 'construction' } },
      { id: 106, nodes: [1, 2, 4, 1], tags: { building: 'no' } },
    ],
    relations: [],
  };
  const r = buildInputs(scene, { style, origin: { lat: 0, lon: 0 } });

  it('builds the scene', () => {
    expect(r.inputs).toHaveLength(3);
    expect(r.stats.skippedByTag).toBe(1);
    const [house, garage, second] = r.inputs as [BuildingInput, BuildingInput, BuildingInput];
    expect(house.hasAddress).toBe(true);
    expect(second.hasAddress).toBe(true);
    expect(garage.hasAddress).toBeUndefined();
    expect(garage.type).toBe('garage');
    // Shop node in a small one-storey building: a store.
    expect(second).toMatchObject({ type: 'store', shop: true });
    // The garage touches the second house, so it joins that plot, not the first.
    expect(garage.groupKey).toBe(second.groupKey);
    expect(house.groupKey).not.toBe(second.groupKey);
    expect(garage.neighbours?.find((n) => n.sameGroup)).toBeDefined();
    // Footway crosses house 1: passage. The road is 5 m away: not a passage, clipped to ±40 m.
    const footway = house.roads?.find((x) => x.kind === 'path');
    expect(footway?.passage).toBe(true);
    const road = house.roads?.find((x) => x.kind === 'road');
    expect(road?.passage).toBeUndefined();
    expect(road?.width).toBe(6);
    const xs = (road?.line ?? []).map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-40, 3);
    expect(Math.max(...xs)).toBeCloseTo(50, 3);
    expect(second.roads?.some((x) => x.passage)).toBe(false);
  });

  it('filters by bbox but keeps outside buildings as neighbours', () => {
    const only = buildInputs(scene, {
      style,
      origin: { lat: 0, lon: 0 },
      bbox: { minLat: -1, minLon: 12 * M, maxLat: 1, maxLon: 20 * M },
    });
    expect(only.inputs).toHaveLength(1);
    expect(only.meta[0]?.osmId).toBe(101);
    expect(only.inputs[0]?.neighbours?.length).toBe(1);
    expect(only.stats.skippedOutside).toBe(2);
    expect(only.inputs[0]?.seed).toBe(r.inputs[1]?.seed);
  });

  it('keeps the passage when more roads than the cap touch the building', () => {
    // A 40 x 20 m block with 14 footways ending on its south wall (distance 0, low ids)
    // and a passage through it with the highest id: the cap of 12 must not drop it.
    const nodes = [node(1, 0, 0), node(2, 40, 0), node(3, 40, 20), node(4, 0, 20)];
    const ways: OsmData['ways'] = [{ id: 100, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes' } }];
    for (let k = 0; k < 14; k++) {
      nodes.push(node(10 + 2 * k, 2 + 2.5 * k, -10), node(11 + 2 * k, 2 + 2.5 * k, 0));
      ways.push({ id: 200 + k, nodes: [10 + 2 * k, 11 + 2 * k], tags: { highway: 'footway' } });
    }
    nodes.push(node(90, 20, 30), node(91, 20, 10));
    ways.push({ id: 900, nodes: [90, 91], tags: { highway: 'footway', tunnel: 'building_passage' } });
    const crowded = buildInputs({ nodes, ways, relations: [] }, { style, origin: { lat: 0, lon: 0 } });
    const roads = crowded.inputs[0]?.roads ?? [];
    expect(roads).toHaveLength(12);
    expect(roads[0]?.passage).toBe(true);
  });
});
