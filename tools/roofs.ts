/**
 * Dev tool: sheets of roofs on non-rectangular footprints.
 * `pnpm exec tsx tools/roofs.ts <outdir>` writes one PNG per roof shape, each from two sides.
 */
import { mkdirSync } from 'node:fs';
import { type BuildingInput, type RoofShape, type Vec2, generateBuilding } from '../packages/core/src';
import { Rng } from '../packages/core/src';
import { COURTYARD, FAMILIES, FIXED_SHAPES, randomFootprint } from '../packages/core/test/shapes';
import { grid, save } from './render';

const out = process.argv[2] ?? 'renders';
mkdirSync(out, { recursive: true });

const shapes: RoofShape[] = (process.argv[3]?.split(',') as RoofShape[] | undefined) ?? [
  'hipped',
  'gabled',
  'half-hipped',
  'mansard',
  'gambrel',
];
const footprints: { outer: Vec2[]; holes?: Vec2[][] }[] = [
  ...Object.values(FIXED_SHAPES).map((outer) => ({ outer })),
  COURTYARD,
];

const make = (o: Partial<BuildingInput>): ReturnType<typeof generateBuilding> =>
  generateBuilding({
    footprint: { outer: [] },
    style: { region: 'de', modernity: 0.3 },
    seed: 1,
    type: 'house',
    levels: 2,
    colours: { roof: '#a8483a', wall: '#e9e2d0' },
    debug: true,
    ...o,
  });

for (const shape of shapes) {
  const meshes = footprints.map((footprint, i) => {
    const mesh = make({ footprint, roof: { shape }, seed: `roof-${i}` });
    const spec = mesh.debug?.spec;
    if (spec && spec.roof.shape !== shape) console.log(`${shape} #${i}: built as ${spec.roof.shape}`);
    for (const note of spec?.notes ?? []) if (note.includes('roof')) console.log(`${shape} #${i}: ${note}`);
    return mesh;
  });
  for (const [name, azimuth, elevation] of [
    ['a', 25, 38],
    ['b', 205, 38],
    ['top', 0, 89],
  ] as const) {
    save(`${out}/roofs-${shape}-${name}.png`, grid(meshes, 5, 30), {
      azimuth,
      elevation,
      width: 1800,
      height: 1100,
    });
  }
}

// Random footprints, three per family, to catch what the fixed shapes miss.
const rng = new Rng(Number(process.argv[4] ?? 1));
const random = FAMILIES.flatMap((family) => [0, 1, 2].map(() => randomFootprint(family, rng)));
for (const shape of shapes.slice(0, 2)) {
  const meshes = random.map((outer, i) =>
    make({ footprint: { outer }, roof: { shape }, seed: `random-${i}` }),
  );
  save(`${out}/roofs-random-${shape}.png`, grid(meshes, 5, 34), {
    azimuth: 25,
    elevation: 40,
    width: 1800,
    height: 1100,
  });
}

// Neighbours close to some walls: no overhang there, the usual one elsewhere.
const blocked = (['L', 'T', 'rectangle', 'plus'] as const).flatMap((name) =>
  shapes.slice(0, 2).map((shape) => {
    const outer = FIXED_SHAPES[name] as Vec2[];
    const maxX = Math.max(...outer.map((p) => p[0]));
    const maxY = Math.max(...outer.map((p) => p[1]));
    const neighbours = [
      {
        footprint: {
          outer: [
            [maxX + 0.1, -5],
            [maxX + 6, -5],
            [maxX + 6, maxY + 5],
            [maxX + 0.1, maxY + 5],
          ] as Vec2[],
        },
        height: 3,
      },
    ];
    return make({ footprint: { outer }, roof: { shape }, neighbours, seed: `blocked-${name}` });
  }),
);
save(`${out}/roofs-blocked.png`, grid(blocked, 4, 30), {
  azimuth: 115,
  elevation: 35,
  width: 1800,
  height: 1100,
});
