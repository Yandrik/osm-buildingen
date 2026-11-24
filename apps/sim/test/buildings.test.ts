import { type BuildingInput, generateBuilding } from '@osm-buildingen/core';
import type { GeneratorPool } from '@osm-buildingen/three';
import { MeshBasicMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buildings } from '../src/world/buildings';
import { CELL, X0, Y0 } from '../src/world/frame';

const input: BuildingInput = {
  footprint: {
    outer: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  },
  seed: 1,
  style: { region: 'de', modernity: 0.6 },
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

function fixture() {
  const generate = vi.fn<GeneratorPool['generate']>(async (inputs) => ({
    meshes: inputs.map((b) => generateBuilding(b)),
    errors: inputs.map(() => null),
    time: 0,
    times: new Float32Array(inputs.length),
  }));
  const material = new MeshBasicMaterial();
  const buildings = new Buildings({ size: 1, generate, dispose() {} }, material);
  buildings.addTile(X0, Y0, [{ cx: 0, cy: 0, inputs: [input], massingOnly: [] }]);
  cleanup.push(() => {
    buildings.removeTile(X0, Y0);
    material.dispose();
  });
  const update = (distance: number, height = 0, massRadius = 1000) =>
    buildings.update(CELL + distance, CELL / 2, height, massRadius);
  const massing = async (distance: number) => {
    update(distance);
    await vi.waitFor(() => expect(buildings.group.children).toHaveLength(1));
  };
  const full = async (distance: number) => {
    update(distance);
    await vi.waitFor(() => expect(buildings.group.children).toHaveLength(2));
  };
  return { buildings, generate, update, massing, full };
}

describe('HQ building distance', () => {
  it('promotes at the new 200 m default, beyond the old entry radius', async () => {
    const f = fixture();
    expect(f.buildings.highQualityDistance).toBe(200);
    await f.massing(175);
    await f.full(175);
    expect(f.generate.mock.calls[1]?.[0][0]?.detail).toBe('full');
  });

  it('keeps cells outside the entry radius as massing', async () => {
    const f = fixture();
    await f.massing(225);
    f.update(225);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });

  it('applies increases and decreases without rebuilding the massing mesh', async () => {
    const f = fixture();
    f.buildings.highQualityDistance = 100;
    await f.massing(175);
    f.update(175);
    expect(f.generate).toHaveBeenCalledTimes(1);
    const massing = f.buildings.group.children[0];
    f.buildings.highQualityDistance = 250;
    await f.full(175);
    expect(massing?.visible).toBe(false);
    f.buildings.highQualityDistance = 100;
    f.update(175);
    expect(f.buildings.group.children).toEqual([massing]);
    expect(massing?.visible).toBe(true);
  });

  it('retains full detail for a 60 m hysteresis band', async () => {
    const f = fixture();
    await f.massing(175);
    await f.full(175);
    f.update(250);
    expect(f.buildings.group.children).toHaveLength(2);
    f.update(261);
    expect(f.buildings.group.children).toHaveLength(1);
  });

  it('uses altitude as well as horizontal distance', async () => {
    const f = fixture();
    await f.massing(100);
    f.update(100, 220);
    expect(f.generate).toHaveBeenCalledTimes(1);
    await f.full(100);
  });

  it('caps HQ at the overall building radius', async () => {
    const f = fixture();
    f.buildings.highQualityDistance = 1000;
    await f.massing(175);
    f.update(175, 0, 150);
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
});

describe('swapping the generator pool', () => {
  it('disposes the old pool and requests its unfinished cells again on the new one', async () => {
    const f = fixture();
    let rejectStuck: (e: Error) => void = () => {};
    const stuck = vi.fn<GeneratorPool['generate']>(
      () =>
        new Promise((_, reject) => {
          rejectStuck = reject;
        }),
    );
    const dispose = vi.fn(() => rejectStuck(new Error('Generator pool disposed')));
    f.buildings.setPool({ size: 1, generate: stuck, dispose });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.update(175);
    expect(stuck).toHaveBeenCalledTimes(1);

    const generate = vi.fn<GeneratorPool['generate']>(async (inputs) => ({
      meshes: inputs.map((b) => generateBuilding(b)),
      errors: inputs.map(() => null),
      time: 0,
      times: new Float32Array(inputs.length),
    }));
    f.buildings.setPool({ size: 1, generate, dispose() {} });
    expect(dispose).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.massing(175);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
