import { type BuildingInput, generateBuilding } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { createMainThreadPool } from '../src/world/main-thread-pool';
import { defaultThreads, parseThreads, threadsLabel, workerCount } from '../src/world/threads';

const input = (seed: number): BuildingInput => ({
  footprint: {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  },
  seed,
  style: { region: 'de', modernity: 0.6 },
});

/** A manual scheduler and a clock that advances 1 ms per reading. */
function harness() {
  const tasks: (() => void)[] = [];
  let t = 0;
  return {
    schedule: (run: () => void) => tasks.push(run),
    now: () => t++,
    run(): number {
      const task = tasks.shift();
      task?.();
      return tasks.length;
    },
    get queued() {
      return tasks.length;
    },
  };
}

describe('main-thread pool', () => {
  it('produces the same meshes as calling the generator directly', async () => {
    const h = harness();
    const pool = createMainThreadPool({ schedule: h.schedule, now: h.now });
    const inputs = [input(1), input(2), input(3)];
    const result = pool.generate(inputs);
    while (h.run() > 0);
    const { meshes, errors, times } = await result;
    expect(errors).toEqual([null, null, null]);
    expect(times).toHaveLength(3);
    meshes.forEach((m, i) => {
      expect(m?.positions).toEqual(generateBuilding(inputs[i] as BuildingInput).positions);
    });
  });

  it('splits work across slices by the time budget', async () => {
    const h = harness();
    // Each building reads the clock several times, so a 1 ms budget fits one building per slice.
    const pool = createMainThreadPool({ schedule: h.schedule, now: h.now, budget: 1 });
    const result = pool.generate([input(1), input(2), input(3)]);
    let slices = 0;
    while (h.queued > 0) {
      h.run();
      slices++;
    }
    expect(slices).toBe(3);
    expect((await result).meshes).toHaveLength(3);
  });

  it('rejects queued jobs on dispose and refuses new ones', async () => {
    const h = harness();
    const pool = createMainThreadPool({ schedule: h.schedule, now: h.now });
    const result = pool.generate([input(1)]);
    pool.dispose();
    h.run();
    await expect(result).rejects.toThrow('disposed');
    await expect(pool.generate([input(2)])).rejects.toThrow('disposed');
  });
});

describe('thread setting', () => {
  it('parses and clamps stored values', () => {
    expect(parseThreads(null, 4)).toBe(4);
    expect(parseThreads('', 4)).toBe(4);
    expect(parseThreads('abc', 4)).toBe(4);
    expect(parseThreads('2.5', 4)).toBe(4);
    expect(parseThreads('0', 4)).toBe(0);
    expect(parseThreads('-3', 4)).toBe(0);
    expect(parseThreads('42', 4)).toBe(9);
  });

  it('maps 0 to the main thread and 9 to every hardware thread', () => {
    expect(workerCount(0, 16)).toBe(0);
    expect(workerCount(5, 16)).toBe(5);
    expect(workerCount(9, 16)).toBe(16);
    expect(threadsLabel(0, 16)).toBe('UI thread');
    expect(threadsLabel(9, 16)).toBe('all (16)');
  });

  it('keeps the previous defaults', () => {
    expect(defaultThreads(true, 16)).toBe(2);
    expect(defaultThreads(false, 4)).toBe(2);
    expect(defaultThreads(false, 10)).toBe(6);
    expect(defaultThreads(false, 32)).toBe(8);
  });
});
