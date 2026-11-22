/**
 * Dev tool: renders an area from OpenMapTiles-schema vector tiles, like tools/town.ts does for OSM.
 *
 *   pnpm exec tsx tools/town-tiles.ts <out.png> <z-x-y.pbf[.gz]>... [--bbox minLon,minLat,maxLon,maxLat]
 *     [--modernity 0.35] [--azimuth 30]
 *
 * Tile files are named by their address (`14-8646-5668.pbf`); `.gz` files are gunzipped.
 * With `--bbox`, only buildings whose centroid is inside are generated and the origin is
 * the bbox centre (pass an OSM extract's bounds to compare with tools/town.ts).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { generateBuilding } from '../packages/core/src';
import { buildInputsFromTiles, decodeTile } from '../packages/vector-tiles/src';
import { save } from './render';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return v;
};
const bboxText = flag('bbox', '');
const modernity = Number(flag('modernity', '0.35'));
const azimuth = Number(flag('azimuth', '30'));
const [out, ...files] = args;
if (!out || files.length === 0) throw new Error('usage: town-tiles.ts <out.png> <z-x-y.pbf>... [--bbox …]');

const t0 = performance.now();
const tiles = files.map((file) => {
  const m = /(\d+)-(\d+)-(\d+)\.pbf/.exec(basename(file));
  if (!m) throw new Error(`cannot read the tile address from ${file}`);
  let bytes: Uint8Array = readFileSync(file);
  if (file.endsWith('.gz')) bytes = gunzipSync(bytes);
  return decodeTile(new Uint8Array(bytes), Number(m[1]), Number(m[2]), Number(m[3]));
});
const t1 = performance.now();
const [minLon, minLat, maxLon, maxLat] = bboxText ? bboxText.split(',').map(Number) : [];
const bbox =
  minLon !== undefined && minLat !== undefined && maxLon !== undefined && maxLat !== undefined
    ? { minLon, minLat, maxLon, maxLat }
    : undefined;
const { inputs, meta, stats } = buildInputsFromTiles(tiles, {
  style: { region: 'de', modernity },
  ...(bbox ? { bbox } : {}),
});
const t2 = performance.now();

const count = (f: (i: number) => boolean): number => meta.filter((_, i) => f(i)).length;
console.log(
  `${inputs.length} buildings from ${tiles.length} tiles: decode ${(t1 - t0).toFixed(0)} ms, inputs ${(t2 - t1).toFixed(0)} ms`,
);
console.log(
  `  height: ${count((i) => meta[i]?.heightSource === 'levels')} as levels, ${count((i) => meta[i]?.heightSource === 'height')} as height, ${count((i) => meta[i]?.heightSource === 'default')} unknown`,
);
console.log(
  `  typed: ${count((i) => meta[i]?.type !== undefined)}, special: ${count((i) => meta[i]?.special === true)}, with parts: ${count((i) => (meta[i]?.parts ?? 0) > 0)}, addressed: ${count((i) => inputs[i]?.hasAddress === true)}, shop: ${count((i) => inputs[i]?.shop === true)}, passage: ${count((i) => inputs[i]?.roads?.some((r) => r.passage) === true)}`,
);
console.log(`  groups: ${new Set(meta.map((m) => m.groupKey)).size}, stats: ${JSON.stringify(stats)}`);

let triangles = 0;
const notes = new Map<string, number>();
const meshes = inputs.map((input) => {
  const mesh = generateBuilding({ ...input, debug: true, detail: input.detail ?? 'full' });
  triangles += mesh.indices.length / 3;
  for (const n of mesh.debug?.spec.notes ?? []) notes.set(n, (notes.get(n) ?? 0) + 1);
  return mesh;
});
console.log(`  generate ${(performance.now() - t2).toFixed(0)} ms, ${triangles} triangles`);
for (const [n, c] of [...notes].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${c}× ${n}`);
save(
  out,
  meshes.map((mesh) => ({ mesh, x: 0, z: 0 })),
  { width: 2200, height: 1400, azimuth, elevation: 32, sharedGround: true, ground: [205, 203, 196] },
);
