/**
 * Polygons in the z14 tiles are stored whole in the tile of their point-on-surface, so a forest
 * or a river bank can cover tiles that never mention it. This writes, per tile, the area
 * polygons of other tiles that reach into it (translated into the target tile's frame), so
 * the ground painter only needs the tile itself plus its spill file.
 *
 *   pnpm exec tsx scripts/spill.ts data/osm/tiles data/osm/spill
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TILE = 1608.9;
const LAYERS = ['landuse_a', 'water_a', 'natural_a', 'pois_a', 'protected_areas_a', 'traffic_a'];

interface Feature {
  id: number;
  c: string;
  n?: string;
  p?: Record<string, unknown>;
  g: number[][][];
}
interface Index {
  tiles: [number, number, number, number][];
}

const [tilesDir, outDir] = process.argv.slice(2);
if (!tilesDir || !outDir) {
  console.error('usage: spill.ts <tilesDir> <outDir>');
  process.exit(1);
}

const index = JSON.parse(readFileSync(join(tilesDir, 'index.json'), 'utf8')) as Index;
const out = new Map<string, Record<string, Feature[]>>();
let spilled = 0;

for (const [tx, ty] of index.tiles) {
  const tile = JSON.parse(readFileSync(join(tilesDir, '14', String(tx), `${ty}.json`), 'utf8')) as Record<
    string,
    Feature[]
  >;
  for (const layer of LAYERS) {
    for (const f of tile[layer] ?? []) {
      const outer = f.g[0];
      if (!outer) continue;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const [x, y] of outer as unknown as [number, number][]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (minX >= 0 && minY >= 0 && maxX <= TILE && maxY <= TILE) continue;
      // Tile offsets: +x is east, +y (north) is a smaller tile row.
      const dx0 = Math.floor(minX / TILE);
      const dx1 = Math.floor(maxX / TILE);
      const dy0 = Math.floor(minY / TILE);
      const dy1 = Math.floor(maxY / TILE);
      for (let dx = dx0; dx <= dx1; dx++) {
        for (let dy = dy0; dy <= dy1; dy++) {
          if (dx === 0 && dy === 0) continue;
          const key = `${tx + dx}/${ty - dy}`;
          const shifted: Feature = {
            ...f,
            g: f.g.map((ring) => ring.map(([x, y]) => [round(x! - dx * TILE), round(y! - dy * TILE)])),
          };
          let target = out.get(key);
          if (!target) out.set(key, (target = {}));
          (target[layer] ??= []).push(shifted);
          spilled++;
        }
      }
    }
  }
}

for (const [key, layers] of out) {
  const [x, y] = key.split('/');
  mkdirSync(join(outDir, '14', x!), { recursive: true });
  writeFileSync(join(outDir, '14', x!, `${y}.json`), JSON.stringify(layers));
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify({ tiles: [...out.keys()] }));
console.log(`${spilled} spilled polygons into ${out.size} tiles`);

function round(v: number): number {
  return Math.round(v * 10) / 10;
}
