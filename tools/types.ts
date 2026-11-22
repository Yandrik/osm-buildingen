/**
 * Dev tool: sheets for the non-residential types (towers, canopies, stations, industry, trim).
 * `pnpm exec tsx tools/types.ts <outdir> [sheet]` writes <sheet>.png files; without a
 * sheet name it writes all of them and prints typical triangle counts.
 */
import { mkdirSync } from 'node:fs';
import {
  type BuildingInput,
  type BuildingMesh,
  type BuildingType,
  type Vec2,
  generateBuilding,
} from '../packages/core/src';
import { grid, save } from './render';

const out = process.argv[2] ?? 'renders';
const only = process.argv[3];
mkdirSync(out, { recursive: true });

const rect = (w: number, d: number, x = 0, y = 0): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];
const rotate = (ring: Vec2[], deg: number): Vec2[] => {
  const a = (deg * Math.PI) / 180;
  return ring.map(
    (p): Vec2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)],
  );
};
const road = (y: number): { line: Vec2[] } => ({
  line: [
    [-80, y],
    [120, y],
  ],
});
const make = (o: Partial<BuildingInput>): BuildingMesh =>
  generateBuilding({
    footprint: { outer: rect(10, 8) },
    style: { region: 'de', modernity: 0.5 },
    seed: 1,
    roads: [road(-8)],
    ...o,
  });
const tris = (meshes: BuildingMesh[]): string => {
  const t = meshes.map((m) => m.indices.length / 3).sort((a, b) => a - b);
  return `min ${t[0]}, median ${t[Math.floor(t.length / 2)]}, max ${t[t.length - 1]}`;
};
const views = [
  { azimuth: 25, elevation: 22 },
  { azimuth: 205, elevation: 22 },
];
function sheet(
  name: string,
  meshes: BuildingMesh[],
  columns: number,
  spacing: number,
  w = 2000,
  h = 1100,
): void {
  if (only && only !== name) return;
  views.forEach((v, i) =>
    save(`${out}/${name}-${i}.png`, grid(meshes, columns, spacing), { ...v, width: w, height: h }),
  );
  console.log(`${name}: ${meshes.length} buildings, triangles ${tris(meshes)}`);
}

const eras = [0.05, 0.3, 0.55, 0.8, 1];

// --- Towers: five eras x three seeds on a 30 x 30 m footprint, 30 levels where tagged. ---
const towers = [0, 1, 2].flatMap((s) =>
  eras.map((m) =>
    make({
      type: 'skyscraper',
      footprint: { outer: s === 2 ? rect(40, 26) : rect(30, 30) },
      levels: s === 0 ? 30 : undefined,
      style: { region: 'de', modernity: m },
      seed: `tower${s}-${m}`,
    }),
  ),
);
sheet('towers', towers, 5, 60, 2000, 1400);

// Close-up of one old and one new tower.
sheet(
  'towers-close',
  [0.1, 0.5, 0.95].map((m) =>
    make({
      type: 'skyscraper',
      footprint: { outer: rect(30, 30) },
      levels: 30,
      style: { region: 'de', modernity: m },
      seed: `close-${m}`,
    }),
  ),
  3,
  50,
  2000,
  1400,
);

// Tiny and awkward footprints keep the plain prism.
sheet(
  'towers-skip',
  [
    make({ type: 'skyscraper', footprint: { outer: rect(12, 12) }, levels: 25, seed: 'small' }),
    make({
      type: 'skyscraper',
      footprint: {
        outer: [
          [0, 0],
          [40, 0],
          [40, 8],
          [8, 8],
          [8, 40],
          [0, 40],
        ],
      },
      levels: 25,
      seed: 'L',
    }),
    make({ type: 'skyscraper', footprint: { outer: rotate(rect(36, 24), 30) }, levels: 25, seed: 'rot' }),
  ],
  3,
  50,
);

// --- Canopies: carport beside a house, fuel station, building=roof shapes, eras. ---
function scenes(name: string, groups: BuildingMesh[][], columns: number, spacing: number): void {
  if (only && only !== name) return;
  const items = groups.flatMap((g, i) =>
    g.map((mesh) => ({ mesh, x: (i % columns) * spacing, z: Math.floor(i / columns) * spacing })),
  );
  views.forEach((v, k) => save(`${out}/${name}-${k}.png`, items, { ...v, width: 2000, height: 1100 }));
  console.log(`${name}: triangles ${tris(groups.map((g) => g[g.length - 1] as BuildingMesh))}`);
}
const houseAt = rect(10, 8, 0, 0);
const carport = rect(3.2, 6, 10, 1);
scenes(
  'canopies',
  [
    ...[0.1, 0.9].map((m) => [
      make({
        type: 'house',
        footprint: { outer: houseAt },
        style: { region: 'de', modernity: m },
        seed: `h${m}`,
      }),
      make({
        type: 'canopy',
        footprint: { outer: carport },
        neighbours: [{ footprint: { outer: houseAt } }],
        style: { region: 'de', modernity: m },
        seed: `cp${m}`,
      }),
    ]),
    [
      make({
        type: 'canopy',
        footprint: { outer: rect(20, 10) },
        style: { region: 'de', modernity: 0.9 },
        seed: 'fuel',
      }),
    ],
    [
      make({
        type: 'canopy',
        footprint: { outer: rect(20, 10) },
        height: 5.5,
        minHeight: 4.6,
        style: { region: 'de', modernity: 0.7 },
        seed: 'fuel2',
      }),
    ],
    ...(['gabled', 'hipped', 'skillion', 'round'] as const).map((shape) => [
      make({
        type: 'canopy',
        footprint: { outer: rect(8, 5) },
        roof: { shape },
        seed: `r${shape}`,
        style: { region: 'de', modernity: 0.2 },
      }),
    ]),
    [
      make({
        type: 'canopy',
        footprint: {
          outer: [
            [0, 0],
            [14, 0],
            [14, 4],
            [4, 4],
            [4, 12],
            [0, 12],
          ],
        },
        seed: 'Lshelter',
      }),
    ],
    [make({ type: 'canopy', footprint: { outer: rect(6, 3) }, seed: 'carport', detail: 'massing' })],
  ],
  4,
  28,
);

// --- Stations: 40 x 12 m, street to the south, tracks 9 m north of the building. ---
const rail = {
  line: [
    [-80, 21],
    [120, 21],
  ] as Vec2[],
  kind: 'rail' as const,
};
sheet(
  'stations',
  [
    ...eras.map((m) =>
      make({
        type: 'station',
        footprint: { outer: rect(40, 12) },
        roads: [road(-8), rail],
        style: { region: 'de', modernity: m },
        seed: `st${m}`,
      }),
    ),
    ...eras.map((m) =>
      make({
        type: 'station',
        footprint: { outer: rect(16, 9) },
        roads: [road(-8)],
        style: { region: 'de', modernity: m },
        seed: `bus${m}`,
      }),
    ),
  ],
  5,
  55,
);

// --- Industry: 80 x 40 m halls across eras, tagged sawtooth (also rotated), gabled with vents. ---
sheet(
  'industrial',
  [
    ...eras.map((m) =>
      make({
        type: 'industrial',
        footprint: { outer: rect(80, 40) },
        style: { region: 'de', modernity: m },
        seed: `ind${m}`,
      }),
    ),
    make({
      type: 'industrial',
      footprint: { outer: rect(60, 30) },
      roof: { shape: 'sawtooth' },
      seed: 'saw1',
      style: { region: 'de', modernity: 0.1 },
    }),
    make({
      type: 'industrial',
      footprint: { outer: rotate(rect(48, 30), 25) },
      roof: { shape: 'sawtooth' },
      seed: 'saw2',
      style: { region: 'de', modernity: 0.4 },
    }),
    make({
      type: 'industrial',
      footprint: { outer: rect(60, 24) },
      roof: { shape: 'gabled' },
      seed: 'gab',
      year: 1900,
    }),
    make({
      type: 'industrial',
      footprint: { outer: rect(60, 24) },
      roof: { shape: 'flat' },
      seed: 'flat',
      year: 1925,
    }),
    make({
      type: 'industrial',
      footprint: { outer: rect(50, 30) },
      roof: { shape: 'sawtooth' },
      seed: 'saw3',
      year: 1960,
    }),
  ],
  5,
  100,
  2000,
  1300,
);

// --- Trim: older buildings get level bands and a cornice; a terrace row shows the party walls. ---
const trimTypes: [BuildingType, Vec2[]][] = [
  ['house', rect(11, 9)],
  ['townhouse', rect(8, 12)],
  ['apartments', rect(22, 12)],
  ['office', rect(24, 14)],
  ['station', rect(24, 11)],
];
sheet(
  'trim',
  [0.15, 0.3, 0.7].flatMap((m) =>
    trimTypes.map(([type, outer]) =>
      make({
        type,
        footprint: { outer },
        style: { region: 'de', modernity: m },
        seed: `trim-${type}-${m}`,
        year: m < 0.5 ? 1880 + m * 150 : undefined,
      }),
    ),
  ),
  5,
  36,
);
const terrace = [0, 1, 2, 3].map((i) => rect(8, 12, i * 8, 0));
scenes(
  'terrace',
  [
    terrace.map((outer, i) =>
      make({
        type: 'townhouse',
        footprint: { outer },
        neighbours: terrace.filter((_, j) => j !== i).map((o) => ({ footprint: { outer: o } })),
        year: 1900,
        seed: `row${i}`,
      }),
    ),
  ],
  1,
  40,
);

// --- Stores: false front with sign, door canopy, roller door on the side. ---
sheet(
  'stores',
  eras.flatMap((m) =>
    [rect(16, 12), rect(24, 18)].map((outer, i) =>
      make({
        type: 'store',
        footprint: { outer },
        style: { region: 'de', modernity: m },
        seed: `store${i}-${m}`,
      }),
    ),
  ),
  5,
  36,
);

const t0 = performance.now();
for (let i = 0; i < 20; i++) make({ type: 'skyscraper', footprint: { outer: rect(30, 30) }, seed: i });
console.log(`tower: ${((performance.now() - t0) / 20).toFixed(1)} ms each`);
