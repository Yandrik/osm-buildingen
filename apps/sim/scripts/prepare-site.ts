import { execFileSync } from 'node:child_process';
/**
 * Stage a self-contained static deployment without publishing preprocessing inputs.
 * Content-addressed data lets new builds coexist with already-open browser sessions.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const app = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2];
const base = process.argv[3] ?? '/paris-ride/';
if (!output || !base.startsWith('/') || !base.endsWith('/')) {
  throw new Error('Usage: tsx scripts/prepare-site.ts <new-output-directory> [/paris-ride/]');
}
const dest = resolve(output);
// Refuse to mix a new deployment with stale files or overwrite source data.
await mkdir(dest);
const terrain = 'terrain/idf-terrain.pmtiles';
const chunkBytes = 16 * 1024 * 1024;
const terrainBytes = (await stat(join(app, 'data', terrain))).size;
const files = [terrain];
async function jsonFiles(dir: string): Promise<void> {
  for (const entry of (await readdir(join(app, 'data', dir), { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await jsonFiles(path);
    else if (entry.name.endsWith('.json')) files.push(path);
  }
}
for (const dir of ['osm/tiles', 'osm/buildings', 'osm/spill']) await jsonFiles(dir);
const hash = createHash('sha256');
for (const path of files) {
  hash.update(`${path}\0`);
  for await (const chunk of createReadStream(join(app, 'data', path))) hash.update(chunk);
}
const version = hash.digest('hex').slice(0, 20);
const data = join(dest, 'data', version);
let rawBytes = 0;
let gzipBytes = 0;
for (const path of files) {
  const target = join(data, path === terrain ? path : `${path}.gz`);
  await mkdir(dirname(target), { recursive: true });
  if (path === terrain) {
    await mkdir(target);
    const source = await open(join(app, 'data', path), 'r');
    try {
      for (let offset = 0, index = 0; offset < terrainBytes; offset += chunkBytes, index++) {
        const bytes = Buffer.alloc(Math.min(chunkBytes, terrainBytes - offset));
        const { bytesRead } = await source.read(bytes, 0, bytes.length, offset);
        if (bytesRead !== bytes.length) throw new Error('Terrain archive changed during staging');
        await writeFile(join(target, `${index.toString().padStart(4, '0')}.bin`), bytes);
      }
    } finally {
      await source.close();
    }
  } else {
    const raw = await readFile(join(app, 'data', path));
    const compressed = gzipSync(raw, { level: 9 });
    rawBytes += raw.length;
    gzipBytes += compressed.length;
    await writeFile(target, compressed);
  }
}
execFileSync('pnpm', ['exec', 'vite', 'build', '--base', base], {
  cwd: app,
  env: {
    ...process.env,
    VITE_SIM_DATA_URL: `data/${version}/`,
    VITE_SIM_DATA_GZIP: 'true',
    VITE_SIM_DATA_IMMUTABLE: 'true',
    VITE_SIM_TERRAIN_CHUNK_BYTES: String(chunkBytes),
    VITE_SIM_TERRAIN_BYTES: String(terrainBytes),
  },
  stdio: 'inherit',
});
await cp(join(app, 'dist'), dest, { recursive: true });
await writeFile(
  join(dest, 'deployment.json'),
  `${JSON.stringify({ base, dataVersion: version, files: files.length - 1 + Math.ceil(terrainBytes / chunkBytes), rawJsonBytes: rawBytes, gzipJsonBytes: gzipBytes, terrainBytes, terrainChunkBytes: chunkBytes }, null, 2)}\n`,
);
console.log(`Staged ${files.length} data files in ${dest}; JSON ${rawBytes} → ${gzipBytes} bytes.`);
