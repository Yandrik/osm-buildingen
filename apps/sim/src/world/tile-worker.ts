/// <reference lib="webworker" />
/**
 * Prepares one z14 tile off the main thread: terrain heights, painted ground texture,
 * building inputs per cell, trees and bridge decks.
 */
import { FetchSource, PMTiles } from 'pmtiles';
import { ChunkedSource } from './chunked-source';
import { DATA, fetchDataJson } from './data';
import { TILE } from './frame';
import { buildingInputs, ringBox, shapefileBuildings } from './inputs';
import {
  type Line,
  type OsmFeature,
  type OsmTile,
  type Poly,
  type TaggedBuilding,
  mergeTiles,
} from './osm-types';
import { hash2, paintTile } from './paint';
import { roadStyle } from './palette';
import type { BridgeData, TileRequest, TileResponse } from './tile-protocol';

declare const self: DedicatedWorkerGlobalScope;

const terrainUrl = `${DATA}/terrain/idf-terrain.pmtiles`;
const terrain = new PMTiles(
  import.meta.env.VITE_SIM_TERRAIN_CHUNK_BYTES
    ? new ChunkedSource(
        terrainUrl,
        Number(import.meta.env.VITE_SIM_TERRAIN_CHUNK_BYTES),
        Number(import.meta.env.VITE_SIM_TERRAIN_BYTES),
      )
    : new FetchSource(terrainUrl),
);
const PX = 512;

class Lru<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly limit: number) {}
  get(key: string, make: () => T): T {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = make();
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
    return value;
  }
}

interface Cached {
  tile: OsmTile;
  painted: OsmTile;
}
const osmCache = new Lru<Promise<Cached>>(24);
const terrainCache = new Lru<Promise<Float32Array>>(24);

self.onmessage = (event: MessageEvent<TileRequest>): void => {
  handle(event.data).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ kind: 'error', id: event.data.id, message } satisfies TileResponse);
  });
};

async function handle(req: TileRequest): Promise<void> {
  switch (req.kind) {
    case 'far': {
      const px = await decodeTerrain(req.z, req.x, req.y);
      const heights = sampleGrid(px, req.grid);
      self.postMessage({ kind: 'far', id: req.id, heights, grid: req.grid } satisfies TileResponse, [
        heights.buffer,
      ]);
      return;
    }
    case 'terrain': {
      const px = await tileTerrain(req.tx, req.ty);
      const heights = sampleGrid(px, req.grid);
      self.postMessage({ kind: 'terrain', id: req.id, heights, grid: req.grid } satisfies TileResponse, [
        heights.buffer,
      ]);
      return;
    }
    case 'paint': {
      const data = await loadOsm(req.tx, req.ty);
      const bitmap = paintTile(data.painted, req.texSize);
      self.postMessage({ kind: 'paint', id: req.id, bitmap } satisfies TileResponse, [bitmap]);
      return;
    }
    case 'detail': {
      const [px, data] = await Promise.all([tileTerrain(req.tx, req.ty), loadOsm(req.tx, req.ty)]);
      const height = (x: number, n: number): number =>
        samplePx(px, (x / TILE) * PX - 0.5, ((TILE - n) / TILE) * PX - 0.5);
      const tagged = (await taggedBuildings(req.tx, req.ty)) ?? shapefileBuildings(data.tile);
      const cells = buildingInputs(tagged, data.tile, req.tx, req.ty, height);
      const trees = treePoints(data.painted, height);
      const bridges = bridgeDecks(data.tile, height);
      self.postMessage({ kind: 'detail', id: req.id, cells, trees, bridges } satisfies TileResponse, [
        trees.buffer,
      ]);
      return;
    }
  }
}

function tileTerrain(tx: number, ty: number): Promise<Float32Array> {
  return terrainCache.get(`${tx}/${ty}`, () => decodeTerrain(14, tx, ty));
}

function loadOsm(tx: number, ty: number): Promise<Cached> {
  return osmCache.get(`${tx}/${ty}`, async () => {
    const [tile, spill] = await Promise.all([
      fetchJson(`osm/tiles/14/${tx}/${ty}.json`),
      fetchJson(`osm/spill/14/${tx}/${ty}.json`),
    ]);
    return { tile, painted: mergeTiles(tile, spill) };
  });
}

/** Tiles of the full extract with building parts and 3D tags; null when it was not built. */
const taggedIndex: Promise<Set<string> | null> = fetchDataJson('osm/buildings/index.json')
  .then(async (res) => {
    if (!res.ok) return null;
    const index = (await res.json()) as { tiles: [number, number][] };
    return new Set(index.tiles.map(([x, y]) => `${x}/${y}`));
  })
  .catch(() => null);

async function taggedBuildings(tx: number, ty: number): Promise<TaggedBuilding[] | null> {
  const index = await taggedIndex;
  if (!index) return null;
  if (!index.has(`${tx}/${ty}`)) return [];
  const res = await fetchDataJson(`osm/buildings/14/${tx}/${ty}.json`);
  if (!res.ok) throw new Error(`buildings ${tx}/${ty}: ${res.status}`);
  return (await res.json()) as TaggedBuilding[];
}

async function fetchJson(path: string): Promise<OsmTile> {
  const res = await fetchDataJson(path);
  // Tiles without features are not written; the spill file is often missing too.
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as OsmTile;
}

/** Terrarium-decoded elevations, PX x PX, row 0 = north. Missing tiles are sea level. */
async function decodeTerrain(z: number, x: number, y: number): Promise<Float32Array> {
  const out = new Float32Array(PX * PX);
  const tile = await terrain.getZxy(z, x, y);
  if (!tile) return out;
  const bitmap = await createImageBitmap(new Blob([tile.data], { type: 'image/webp' }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  if (bitmap.width !== PX) throw new Error(`unexpected terrain tile size ${bitmap.width}`);
  bitmap.close();
  for (let i = 0; i < PX * PX; i++) {
    out[i] =
      (rgba[i * 4] as number) * 256 + (rgba[i * 4 + 1] as number) + (rgba[i * 4 + 2] as number) / 256 - 32768;
  }
  return out;
}

function samplePx(px: Float32Array, u: number, v: number): number {
  u = Math.max(0, Math.min(PX - 1.0001, u));
  v = Math.max(0, Math.min(PX - 1.0001, v));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const a = px[j * PX + i] as number;
  const b = px[j * PX + i + 1] as number;
  const c = px[(j + 1) * PX + i] as number;
  const d = px[(j + 1) * PX + i + 1] as number;
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

function sampleGrid(px: Float32Array, grid: number): Float32Array {
  const out = new Float32Array((grid + 1) * (grid + 1));
  for (let j = 0; j <= grid; j++) {
    for (let i = 0; i <= grid; i++) {
      out[j * (grid + 1) + i] = samplePx(px, (i / grid) * PX - 0.5, (j / grid) * PX - 0.5);
    }
  }
  return out;
}

const FOREST = new Set(['forest', 'wood']);

function treePoints(tile: OsmTile, height: (x: number, n: number) => number): Float32Array {
  const out: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    out.push(x, y, height(x, y), 0.75 + (hash2(x, y) % 1000) / 1600);
  };
  for (const f of tile.natural ?? []) if (f.c === 'tree') push(f.g[0], f.g[1]);
  const forests: OsmFeature<Poly>[] = [
    ...(tile.landuse_a ?? []).filter((f) => FOREST.has(f.c)),
    ...(tile.natural_a ?? []).filter((f) => FOREST.has(f.c)),
  ];
  const step = 11;
  for (const f of forests) {
    const box = ringBox(f.g[0] ?? []);
    const x0 = Math.max(0, Math.floor(box[0] / step) * step);
    const y0 = Math.max(0, Math.floor(box[1] / step) * step);
    for (let y = y0; y < Math.min(TILE, box[3]); y += step) {
      for (let x = x0; x < Math.min(TILE, box[2]); x += step) {
        const h = hash2(x, y);
        const px = x + ((h & 255) / 255) * step;
        const py = y + (((h >> 8) & 255) / 255) * step;
        if (insidePoly(f.g, px, py)) push(px, py);
        if (out.length > 4 * 24000) break;
      }
    }
  }
  return new Float32Array(out);
}

function insidePoly(poly: Poly, x: number, y: number): boolean {
  let inside = false;
  for (const ring of poly) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i] as [number, number];
      const b = ring[j] as [number, number];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
  }
  return inside;
}

function bridgeDecks(tile: OsmTile, height: (x: number, n: number) => number): BridgeData[] {
  const out: BridgeData[] = [];
  const add = (f: OsmFeature<Line>, width: number, rail: boolean): void => {
    const line = f.g;
    if (line.length < 2) return;
    const first = line[0] as [number, number];
    const last = line[line.length - 1] as [number, number];
    const h0 = height(first[0], first[1]);
    const h1 = height(last[0], last[1]);
    const lengths = [0];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as [number, number];
      const b = line[i] as [number, number];
      lengths.push((lengths[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = lengths[lengths.length - 1] || 1;
    const pts: number[] = [];
    line.forEach(([x, y], i) => {
      const t = (lengths[i] as number) / total;
      // Decks rise slightly in the middle so long spans clear the ground under them.
      const arch = Math.sin(t * Math.PI) * Math.min(2, total / 60);
      const deck = Math.max(h0 + (h1 - h0) * t + arch, height(x, y) + 0.3);
      pts.push(x, y, deck);
    });
    out.push({ pts, width, rail });
  };
  for (const f of tile.roads ?? []) {
    if (f.p?.bridge !== 'T') continue;
    add(f, Math.max(2.5, roadStyle(f.c).width), false);
  }
  for (const f of tile.railways ?? []) {
    if (f.p?.bridge !== 'T') continue;
    add(f, 4, true);
  }
  return out;
}
