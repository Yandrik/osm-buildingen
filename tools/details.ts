/** Dev tool: close-ups of roof details, passages and multi-part buildings. `pnpm exec tsx tools/details.ts <outdir>` */
import { mkdirSync } from 'node:fs';
import { type BuildingInput, type Vec2, generateBuilding } from '../packages/core/src';
import { grid, save } from './render';

const out = process.argv[2] ?? 'renders';
mkdirSync(out, { recursive: true });
const rect = (w: number, d: number, x = 0, y = 0): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];
const road = {
  line: [
    [-50, -8],
    [80, -8],
  ] as Vec2[],
};
const make = (o: Partial<BuildingInput>): ReturnType<typeof generateBuilding> =>
  generateBuilding({
    footprint: { outer: rect(11, 9) },
    style: { region: 'de', modernity: 0.5 },
    seed: 1,
    roads: [road],
    ...o,
  });

const meshes = [
  // Dormers and chimneys: steep roofs, several seeds.
  ...[1, 2, 3, 4].map((s) =>
    make({
      type: 'house',
      seed: `d${s}`,
      roof: { shape: 'gabled', height: 4.5 },
      levels: 2,
      style: { region: 'de', modernity: 0.7 },
    }),
  ),
  // Passage through a long block.
  make({
    type: 'apartments',
    footprint: { outer: rect(34, 11) },
    roads: [
      road,
      {
        line: [
          [17, -30],
          [17, 40],
        ] as Vec2[],
        width: 4,
        passage: true,
      },
    ],
    levels: 4,
    seed: 'arch',
  }),
  // Parts: tall core with a low wing and a tower on top.
  make({
    type: 'office',
    footprint: { outer: rect(30, 14) },
    parts: [
      { footprint: { outer: rect(18, 14) }, levels: 6, roof: { shape: 'flat' } },
      { footprint: { outer: rect(12, 14, 18, 0) }, levels: 3, roof: { shape: 'flat' } },
      {
        footprint: { outer: rect(6, 6, 2, 4) },
        levels: 8,
        minLevel: 6,
        roof: { shape: 'pyramidal', height: 4 },
      },
    ],
    seed: 'parts',
  }),
  make({
    type: 'store',
    footprint: { outer: rect(18, 12) },
    seed: 'store',
    style: { region: 'de', modernity: 0.9 },
  }),
  make({
    type: 'townhouse',
    footprint: { outer: rect(7, 12) },
    seed: 'th',
    shop: true,
    style: { region: 'de', modernity: 0.15 },
  }),
];
save(`${out}/details.png`, grid(meshes, 4, 30), { azimuth: 25, elevation: 24, width: 2000, height: 1100 });
