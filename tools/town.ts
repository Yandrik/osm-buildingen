/**
 * Dev tool: renders an OSM extract. `pnpm exec tsx tools/town.ts <file.osm> <out.png> [modernity] [azimuth]`
 */
import { readFileSync } from 'node:fs';
import { generateBuilding } from '../packages/core/src';
import { buildInputs, parseOsmXml } from '../packages/osm/src';
import { save } from './render';

const [file, out, modernity = '0.35', azimuth = '30'] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: town.ts <file.osm> <out.png> [modernity] [azimuth]');
const t0 = performance.now();
const data = parseOsmXml(readFileSync(file, 'utf8'));
const t1 = performance.now();
const { inputs } = buildInputs(data, { style: { region: 'de', modernity: Number(modernity) } });
const t2 = performance.now();
let triangles = 0;
const notes = new Map<string, number>();
const meshes = inputs.map((input, i) => {
  const mesh = generateBuilding({
    ...input,
    debug: true,
    detail: input.detail ?? 'full',
  });
  triangles += mesh.indices.length / 3;
  for (const n of mesh.debug?.spec.notes ?? []) notes.set(n, (notes.get(n) ?? 0) + 1);
  if (mesh.debug?.facade?.fallback) notes.set('facade fallback', (notes.get('facade fallback') ?? 0) + 1);
  return mesh;
});
const t3 = performance.now();
console.log(
  `${inputs.length} buildings: parse ${(t1 - t0).toFixed(0)} ms, inputs ${(t2 - t1).toFixed(0)} ms, generate ${(t3 - t2).toFixed(0)} ms, ${triangles} triangles`,
);
for (const [n, c] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${c}× ${n}`);
save(
  out,
  meshes.map((mesh) => ({ mesh, x: 0, z: 0 })),
  {
    width: 2200,
    height: 1400,
    azimuth: Number(azimuth),
    elevation: 32,
    sharedGround: true,
    ground: [205, 203, 196],
  },
);
