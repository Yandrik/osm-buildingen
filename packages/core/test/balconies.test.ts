/** Balconies per storey and ground-floor stores. See plan/pipeline/04-facade-wfc.md. */
import { describe, expect, it } from 'vitest';
import {
  type BuildingDebug,
  type BuildingInput,
  type FacadeCell,
  generateBuilding,
  resolveBuilding,
} from '../src';
import { rect } from './shapes';

const road = { line: [[-50, -8] as [number, number], [80, -8] as [number, number]] };

const input = (o: Partial<BuildingInput>): BuildingInput => ({
  footprint: { outer: rect(14, 10) },
  style: { region: 'de', modernity: 0.6 },
  seed: 1,
  roads: [road],
  debug: true,
  ...o,
});

const cellsOf = (o: Partial<BuildingInput>): FacadeCell[] =>
  ((generateBuilding(input(o)).debug as BuildingDebug).facade?.cells ?? []) as FacadeCell[];

describe('balconies', () => {
  it('are rare on houses (about one in seven)', () => {
    let n = 0;
    const total = 400;
    for (let i = 0; i < total; i++) {
      if (resolveBuilding(input({ type: 'house', levels: 2, seed: `p${i}` })).balcony) n++;
    }
    expect(n / total).toBeGreaterThan(0.08);
    expect(n / total).toBeLessThan(0.22);
  });

  it('line up storey by storey and are never on the ground row', () => {
    for (let i = 0; i < 40; i++) {
      for (const type of ['house', 'apartments'] as const) {
        const cells = cellsOf({ type, levels: 4, balconies: true, seed: `s${i}` });
        const withBalcony = cells.filter((c) => c.balcony);
        for (const c of withBalcony) expect(c.row).toBeGreaterThan(0);
        // Same columns on every upper storey of a wall.
        const key = (c: FacadeCell): string => `${c.wall}:${c.column}`;
        const byColumn = new Map<string, number>();
        for (const c of withBalcony) byColumn.set(key(c), (byColumn.get(key(c)) ?? 0) + 1);
        for (const count of byColumn.values()) expect(count).toBe(3);
      }
    }
  });

  it('can be shared by several bays, with doors and windows behind one slab', () => {
    let shared = 0;
    for (let i = 0; i < 60; i++) {
      const cells = cellsOf({ type: 'apartments', levels: 3, balconies: true, seed: `m${i}` });
      for (const c of cells) {
        if (!c.balcony?.right) continue;
        shared++;
        const next = cells.find((d) => d.wall === c.wall && d.row === c.row && d.column === c.column + 1);
        expect(next?.balcony?.left).toBe(true);
      }
      // Every balcony has at least one door onto it.
      for (const c of cells) {
        if (!c.balcony || c.balcony.left) continue;
        const run: FacadeCell[] = [];
        for (let col = c.column; ; col++) {
          const d = cells.find((x) => x.wall === c.wall && x.row === c.row && x.column === col);
          if (!d?.balcony) break;
          run.push(d);
          if (!d.balcony.right) break;
        }
        expect(run.some((d) => d.role === 'balcony')).toBe(true);
        expect(run.every((d) => d.role === 'balcony' || d.role === 'window')).toBe(true);
      }
    }
    expect(shared).toBeGreaterThan(0);
  });

  it('can be forbidden', () => {
    for (let i = 0; i < 20; i++) {
      const cells = cellsOf({ type: 'apartments', balconies: false, seed: `f${i}` });
      expect(cells.some((c) => c.balcony || c.role === 'balcony')).toBe(false);
    }
  });
});

describe('ground-floor stores', () => {
  it('shopProbability 1 gives houses, apartments and townhouses a shop front', () => {
    for (const type of ['house', 'apartments', 'townhouse'] as const) {
      for (let i = 0; i < 10; i++) {
        const o = { type, levels: 3, shopProbability: 1, seed: `shop${i}` };
        expect(resolveBuilding(input(o)).shop).toBe(true);
        expect(cellsOf(o).some((c) => c.role === 'shop')).toBe(true);
      }
    }
  });

  it('shopProbability 0 gives none', () => {
    for (const type of ['house', 'apartments', 'townhouse'] as const) {
      for (let i = 0; i < 10; i++) {
        expect(resolveBuilding(input({ type, shopProbability: 0, seed: `n${i}` })).shop).toBe(false);
      }
    }
  });
});
