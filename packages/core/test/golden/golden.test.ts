/**
 * Golden test: fixed inputs must keep producing the same mesh.
 *
 * - Output changed on purpose? Bump GENERATOR_VERSION (src/version.ts), then run
 *   `pnpm golden:update` and commit the new golden.json.
 * - Output changed by accident? This test tells you before users see it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_TYPES,
  type BuildingInput,
  type BuildingMesh,
  GENERATOR_VERSION,
  type Vec2,
  generateBuilding,
} from '../../src';

const file = join(dirname(fileURLToPath(import.meta.url)), 'golden.json');
const rect = (w: number, d: number, x = 0, y = 0): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];
const L: Vec2[] = [
  [0, 0],
  [14, 0],
  [14, 7],
  [7, 7],
  [7, 13],
  [0, 13],
];
const road = {
  line: [
    [-40, -9],
    [60, -9],
  ] as Vec2[],
};

function cases(): Record<string, BuildingInput> {
  const out: Record<string, BuildingInput> = {};
  const base: BuildingInput = {
    footprint: { outer: rect(11, 9) },
    style: { region: 'de', modernity: 0.5 },
    seed: 'golden',
    roads: [road],
  };
  for (const type of BUILDING_TYPES) {
    for (const modernity of [0.1, 0.9]) {
      for (const region of ['de', 'us'] as const) {
        out[`${type}/${region}/${modernity}`] = {
          ...base,
          type,
          style: { region, modernity },
          seed: `${type}-${modernity}`,
        };
      }
    }
  }
  for (const shape of [
    'gabled',
    'hipped',
    'half-hipped',
    'mansard',
    'gambrel',
    'skillion',
    'pyramidal',
    'flat',
  ] as const) {
    out[`roof/${shape}/L`] = { ...base, footprint: { outer: L }, roof: { shape } };
  }
  out.courtyard = {
    ...base,
    type: 'apartments',
    footprint: { outer: rect(26, 22), holes: [rect(12, 9, 7, 6)] },
  };
  out.blocked = {
    ...base,
    type: 'townhouse',
    footprint: { outer: rect(7, 12) },
    neighbours: [{ footprint: { outer: rect(7, 12, -7, 0) } }, { footprint: { outer: rect(7, 12, 7, 0) } }],
  };
  out.passage = {
    ...base,
    type: 'apartments',
    footprint: { outer: rect(32, 11) },
    roads: [
      road,
      {
        line: [
          [16, -30],
          [16, 40],
        ],
        width: 4,
        passage: true,
      },
    ],
  };
  out.parts = {
    ...base,
    type: 'office',
    footprint: { outer: rect(30, 14) },
    parts: [
      { footprint: { outer: rect(18, 14) }, levels: 6, roof: { shape: 'flat' } },
      { footprint: { outer: rect(12, 14, 18, 0) }, levels: 3, roof: { shape: 'hipped' } },
    ],
  };
  out.massing = { ...base, detail: 'massing' };
  out.tagged = {
    ...base,
    height: 11,
    levels: 2,
    roof: { shape: 'gabled', height: 4, ridge: 'across' },
    colours: { wall: '#ffcc88', roof: 'black' },
    year: 1910,
  };
  return out;
}

/** Hash of the mesh with positions rounded to millimetres, so float noise between platforms does not matter. */
function hashMesh(mesh: BuildingMesh): string {
  let h = 0x811c9dc5;
  const feed = (v: number): void => {
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of mesh.positions) feed(Math.round(p * 1000));
  for (const c of mesh.colors) feed(c);
  for (const i of mesh.indices) feed(i);
  return `${mesh.positions.length / 3}v-${mesh.indices.length / 3}t-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

describe('golden meshes', () => {
  const all = cases();
  const current: Record<string, string> = {};
  for (const [name, input] of Object.entries(all)) current[name] = hashMesh(generateBuilding(input));

  if (process.env.UPDATE_GOLDEN) {
    writeFileSync(file, `${JSON.stringify({ version: GENERATOR_VERSION, meshes: current }, null, 2)}\n`);
  }
  const stored = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { version: number; meshes: Record<string, string> })
    : { version: -1, meshes: {} };

  it('golden.json matches GENERATOR_VERSION', () => {
    expect(stored.version, 'GENERATOR_VERSION changed: run `pnpm golden:update` and commit golden.json').toBe(
      GENERATOR_VERSION,
    );
  });

  it('output is unchanged for every case', () => {
    const changed = Object.keys(current).filter((name) => stored.meshes[name] !== current[name]);
    expect(changed, 'output changed without a GENERATOR_VERSION bump (or golden.json is stale)').toEqual([]);
    expect(Object.keys(stored.meshes).sort()).toEqual(Object.keys(current).sort());
  });
});
