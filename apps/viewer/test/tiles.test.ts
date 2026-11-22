import type { BuildingInput, BuildingMesh } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { parseBBox, parseCentre } from '../src/area';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/state';
import {
  type BatchResult,
  type TileResult,
  assignTiles,
  createScheduler,
  inputForLevel,
  levelFor,
  orderByDistance,
  splitEven,
  tileDistance,
  tilesToRegenerate,
} from '../src/tiles';

const fakeMesh = { indices: new Uint32Array(3) } as unknown as BuildingMesh;
const fakeInput = (i: number): BuildingInput =>
  ({ seed: i, footprint: { outer: [] }, style: { region: 'de', modernity: 0.5 } }) as BuildingInput;

describe('tiling', () => {
  it('assigns by centroid with floor, including negative coordinates', () => {
    const tiles = assignTiles(
      [
        [10, 10],
        [-10, 10],
        [249, 0],
        [250, 0],
        [-0.1, -0.1],
      ],
      250,
    );
    const byKey = Object.fromEntries(tiles.map((t) => [t.key, t.buildings]));
    expect(byKey).toEqual({ '0,0': [0, 2], '-1,0': [1], '1,0': [3], '-1,-1': [4] });
  });

  it('measures distance to the square and orders nearest first', () => {
    const tiles = assignTiles(
      [
        [10, 10],
        [600, 10],
        [300, 10],
      ],
      250,
    );
    const t0 = tiles.find((t) => t.key === '0,0')!;
    expect(tileDistance(t0, [100, 100])).toBe(0);
    expect(tileDistance(t0, [300, 100])).toBe(50);
    expect(orderByDistance(tiles, [700, 0]).map((t) => t.key)).toEqual(['2,0', '1,0', '0,0']);
  });

  it('picks levels for auto detail and finds tiles to regenerate', () => {
    const tiles = assignTiles(
      [
        [10, 10],
        [1000, 10],
      ],
      250,
    );
    const near = tiles.find((t) => t.key === '0,0')!;
    const far = tiles.find((t) => t.key === '4,0')!;
    expect(levelFor(near, 'auto', [0, 0], 300)).toBe('full');
    expect(levelFor(far, 'auto', [0, 0], 300)).toBe('massing');
    expect(levelFor(far, 'full', [0, 0], 300)).toBe('full');
    const current = new Map([
      ['0,0', 'full' as const],
      ['4,0', 'full' as const],
    ]);
    const jobs = tilesToRegenerate(tiles, current, (t) => levelFor(t, 'auto', [0, 0], 300));
    expect(jobs.map((j) => [j.tile.key, j.level])).toEqual([['4,0', 'massing']]);
  });

  it('splits evenly', () => {
    expect(splitEven([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitEven([1, 2, 3, 4, 5, 6, 7], 4)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7],
    ]);
    expect(splitEven([], 4)).toEqual([]);
  });

  it('keeps special massing at full level and forces massing otherwise', () => {
    const special = { ...fakeInput(1), detail: 'massing' as const };
    expect(inputForLevel(special, 'full', false)).toBe(special);
    expect(inputForLevel(fakeInput(2), 'massing', false).detail).toBe('massing');
    expect(inputForLevel(fakeInput(2), 'full', true).debug).toBe(true);
  });
});

describe('scheduler', () => {
  function setup(concurrency: number) {
    const calls: { inputs: BuildingInput[]; resolve: (r: BatchResult) => void }[] = [];
    const done: TileResult[] = [];
    let priorityTarget = 0;
    const scheduler = createScheduler({
      concurrency,
      batchSize: 2,
      generate: (inputs) => new Promise((resolve) => calls.push({ inputs, resolve })),
      inputs: (buildings) => buildings.map(fakeInput),
      priority: (tile) => Math.abs(tile.i - priorityTarget),
      onTile: (r) => done.push(r),
      onFailure: () => {},
      onProgress: () => {},
      now: () => 0,
    });
    const answer = async (k: number): Promise<void> => {
      const call = calls[k]!;
      call.resolve({ meshes: call.inputs.map(() => fakeMesh), errors: call.inputs.map(() => null), time: 1 });
      await new Promise((r) => setTimeout(r, 0));
    };
    return {
      calls,
      done,
      scheduler,
      answer,
      setTarget: (t: number) => {
        priorityTarget = t;
      },
    };
  }

  const tiles = assignTiles(
    [
      [10, 0],
      [20, 0],
      [30, 0],
      [260, 0],
      [600, 0],
    ],
    250,
  );

  it('finishes a started tile before opening the next, nearest first', async () => {
    const t = setup(1);
    t.setTarget(2);
    t.scheduler.schedule(tiles.map((tile) => ({ tile, level: 'full' as const })));
    expect(t.calls[0]!.inputs.map((i) => i.seed)).toEqual([4]); // tile 2,0 nearest
    await t.answer(0);
    expect(t.done.map((d) => d.tile.key)).toEqual(['2,0']);
    t.setTarget(0);
    expect(t.calls[1]!.inputs.map((i) => i.seed)).toEqual([3]); // picked before the target moved
    await t.answer(1);
    // Tile 0,0 has two batches; its first batch starts it, the second follows before anything else.
    expect(t.calls[2]!.inputs.map((i) => i.seed)).toEqual([0, 1]);
    await t.answer(2);
    expect(t.calls[3]!.inputs.map((i) => i.seed)).toEqual([2]);
    await t.answer(3);
    expect(t.done.map((d) => d.tile.key)).toEqual(['2,0', '1,0', '0,0']);
    expect(t.done[2]!.meshes).toHaveLength(3);
    expect(t.scheduler.progress()).toEqual({ done: 3, total: 3, running: false });
  });

  it('ignores results of cancelled and replaced jobs', async () => {
    const t = setup(2);
    const first = tiles.find((x) => x.key === '0,0')!;
    t.scheduler.schedule([{ tile: first, level: 'full' }]);
    t.scheduler.schedule([{ tile: first, level: 'massing' }]);
    expect(t.scheduler.queuedLevels().get('0,0')).toBe('massing');
    await t.answer(0);
    await t.answer(1);
    expect(t.done).toHaveLength(0);
    await t.answer(2);
    await t.answer(3);
    expect(t.done.map((d) => d.level)).toEqual(['massing']);
    t.scheduler.schedule([{ tile: first, level: 'full' }]);
    t.scheduler.cancelAll();
    await t.answer(4);
    await t.answer(5);
    expect(t.done).toHaveLength(1);
  });
});

describe('area and settings', () => {
  it('parses bbox forms', () => {
    expect(parseBBox('bbox=9.98813,48.39654,9.99593,48.40006')).toEqual({
      bbox: { minLon: 9.98813, minLat: 48.39654, maxLon: 9.99593, maxLat: 48.40006 },
    });
    expect('error' in parseBBox('1,2,3')).toBe(true);
    expect('error' in parseBBox('10,50,9,51')).toBe(true);
    expect('error' in parseBBox('0,0,10,10')).toBe(true); // too large
    const c = parseCentre('48.4, 9.99', 100);
    expect('bbox' in c && c.bbox.maxLat - c.bbox.minLat).toBeCloseTo(200 / 111320, 8);
  });

  it('sanitizes stored settings', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ region: 'fr', modernity: 3, shopProbability: null, colourBy: 'era' });
    expect(s.region).toBe('de');
    expect(s.modernity).toBe(1);
    expect(s.shopProbability).toBeNull();
    expect(s.colourBy).toBe('era');
  });
});
