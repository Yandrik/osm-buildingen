/** Dev tool: sample sheets for eyeballing the generator. `pnpm exec tsx tools/sheet.ts <outdir>` */
import { mkdirSync } from 'node:fs';
import { type BuildingInput, type BuildingType, type Vec2, generateBuilding } from '../packages/core/src';
import { grid, save } from './render';

const out = process.argv[2] ?? 'renders';
mkdirSync(out, { recursive: true });
const rect = (w: number, d: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];
const road = {
  line: [
    [-50, -8],
    [80, -8],
  ] as Vec2[],
};
const make = (o: Partial<BuildingInput>): ReturnType<typeof generateBuilding> =>
  generateBuilding({
    footprint: { outer: rect(10, 8) },
    style: { region: 'de', modernity: 0.5 },
    seed: 1,
    roads: [road],
    ...o,
  });

// Houses across eras.
const eras = [0, 0.2, 0.4, 0.6, 0.8, 1];
save(
  `${out}/houses.png`,
  grid(
    [0, 1, 2].flatMap((row) =>
      eras.map((m) => make({ type: 'house', style: { region: 'de', modernity: m }, seed: `h${row}-${m}` })),
    ),
    6,
    17,
  ),
  { azimuth: 25, elevation: 28 },
);

// One of each type, old / mid / new.
const types: [BuildingType, Vec2[]][] = [
  ['house', rect(10, 8)],
  ['apartments', rect(22, 12)],
  ['townhouse', rect(7, 11)],
  ['garage', rect(6, 6)],
  ['shed', rect(3, 2.5)],
  ['office', rect(24, 14)],
  ['industrial', rect(40, 22)],
  ['station', rect(20, 9)],
  ['store', rect(16, 12)],
];
save(
  `${out}/types.png`,
  grid(
    [0.1, 0.5, 0.95].flatMap((m) =>
      types.map(([type, outer]) =>
        make({ type, footprint: { outer }, style: { region: 'de', modernity: m }, seed: `${type}${m}` }),
      ),
    ),
    9,
    34,
  ),
  { azimuth: 25, elevation: 28, width: 2000, height: 900 },
);

const t0 = performance.now();
let tris = 0;
for (let i = 0; i < 300; i++) tris += make({ type: 'house', seed: i }).indices.length / 3;
console.log(
  `300 houses: ${((performance.now() - t0) / 300).toFixed(2)} ms each, ${(tris / 300).toFixed(0)} triangles each`,
);
