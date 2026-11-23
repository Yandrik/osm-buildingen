/**
 * Paints one tile's ground texture: landuse, water, roads, rails and building footprints.
 * Roads live in the texture rather than as meshes, so they follow the terrain exactly.
 */
import { TILE } from './frame';
import type { Line, OsmFeature, OsmTile, Poly } from './osm-types';
import {
  BUILDING_FOOTPRINT,
  GROUND,
  LANDUSE,
  RAIL,
  WATER,
  WATERWAY_WIDTH,
  WATER_EDGE,
  roadStyle,
} from './palette';

type Ctx = OffscreenCanvasRenderingContext2D;

const PARK_POIS = new Set(['park', 'garden', 'pitch', 'playground', 'golf_course', 'stadium']);

export function paintTile(tile: OsmTile, size: number): ImageBitmap {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d') as Ctx;
  const scale = size / TILE;
  // North up: canvas y grows southward.
  ctx.setTransform(scale, 0, 0, -scale, 0, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const px = 1 / scale;

  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, TILE, TILE);

  // Larger areas first so small ones (a park inside a residential zone) stay visible.
  const areas: { f: OsmFeature<Poly>; colour: string; area: number }[] = [];
  const addAreas = (list: OsmFeature<Poly>[] | undefined, filter?: (c: string) => boolean): void => {
    for (const f of list ?? []) {
      if (filter && !filter(f.c)) continue;
      const colour = LANDUSE[f.c];
      if (!colour) continue;
      areas.push({ f, colour, area: Math.abs(ringArea(f.g[0] ?? [])) });
    }
  };
  addAreas(tile.landuse_a);
  addAreas(tile.natural_a);
  addAreas(tile.pois_a, (c) => PARK_POIS.has(c));
  addAreas(tile.traffic_a, (c) => c === 'parking');
  areas.sort((a, b) => b.area - a.area);
  for (const { f, colour } of areas) {
    ctx.fillStyle = colour;
    fillPoly(ctx, f.g);
  }
  if (size >= 1024) forestStipple(ctx, tile, px);

  ctx.fillStyle = WATER;
  ctx.strokeStyle = WATER_EDGE;
  ctx.lineWidth = Math.max(px, 1.2);
  for (const f of tile.water_a ?? []) {
    fillPoly(ctx, f.g);
    strokePoly(ctx, f.g);
  }
  for (const f of tile.waterways ?? []) {
    const w = Number(f.p?.width) || WATERWAY_WIDTH[f.c] || 2;
    ctx.strokeStyle = WATER;
    ctx.lineWidth = Math.max(px, w);
    strokeLine(ctx, f.g);
  }

  const visible = (f: OsmFeature<Line>): boolean => f.p?.tunnel !== 'T' && f.p?.bridge !== 'T';

  const rails = (tile.railways ?? []).filter(visible);
  ctx.strokeStyle = RAIL.casing;
  ctx.lineWidth = Math.max(px, RAIL.width + 1);
  for (const f of rails) strokeLine(ctx, f.g);
  ctx.strokeStyle = RAIL.fill;
  ctx.lineWidth = Math.max(px, RAIL.width - 0.6);
  for (const f of rails) strokeLine(ctx, f.g);

  const roads = (tile.roads ?? []).filter(visible);
  roads.sort((a, b) => roadStyle(a.c).rank - roadStyle(b.c).rank);
  // Casings of everything first, then fills: junctions merge instead of showing outlines.
  for (const f of roads) {
    const s = roadStyle(f.c);
    ctx.strokeStyle = s.casing;
    ctx.lineWidth = Math.max(px * 1.5, s.width + Math.max(1, px * 1.2));
    strokeLine(ctx, f.g);
  }
  for (const f of roads) {
    const s = roadStyle(f.c);
    ctx.strokeStyle = s.fill;
    ctx.lineWidth = Math.max(px, s.width);
    strokeLine(ctx, f.g);
  }
  if (px < 1) {
    ctx.strokeStyle = '#efe9d6';
    ctx.lineWidth = Math.max(px, 0.25);
    ctx.setLineDash([3, 6]);
    ctx.lineCap = 'butt';
    for (const f of roads) {
      if (!roadStyle(f.c).dashes || f.p?.oneway === 'T' || f.p?.oneway === 'F') continue;
      strokeLine(ctx, f.g);
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }

  ctx.fillStyle = BUILDING_FOOTPRINT;
  for (const f of tile.buildings_a ?? []) fillPoly(ctx, f.g);

  return canvas.transferToImageBitmap();
}

/** Dark dots in forests: reads as canopy from the air when the trees themselves are not drawn. */
function forestStipple(ctx: Ctx, tile: OsmTile, px: number): void {
  ctx.save();
  ctx.fillStyle = '#4b8239';
  for (const f of tile.landuse_a ?? []) {
    if (f.c !== 'forest' && f.c !== 'wood') continue;
    ctx.save();
    pathPoly(ctx, f.g);
    ctx.clip('evenodd');
    const outer = f.g[0] ?? [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [x, y] of outer) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    minX = Math.max(minX, 0);
    minY = Math.max(minY, 0);
    maxX = Math.min(maxX, TILE);
    maxY = Math.min(maxY, TILE);
    const step = 9;
    const r = Math.max(px, 2.6);
    for (let y = Math.floor(minY / step) * step; y < maxY; y += step) {
      for (let x = Math.floor(minX / step) * step; x < maxX; x += step) {
        const h = hash2(x, y);
        ctx.beginPath();
        ctx.arc(x + (h & 7) - 3.5, y + ((h >> 3) & 7) - 3.5, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

function pathPoly(ctx: Ctx, g: Poly): void {
  ctx.beginPath();
  for (const ring of g) {
    const first = ring[0];
    if (!first) continue;
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i] as [number, number];
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
  }
}

function fillPoly(ctx: Ctx, g: Poly): void {
  pathPoly(ctx, g);
  ctx.fill('evenodd');
}

function strokePoly(ctx: Ctx, g: Poly): void {
  pathPoly(ctx, g);
  ctx.stroke();
}

function strokeLine(ctx: Ctx, line: Line): void {
  const first = line[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < line.length; i++) {
    const p = line[i] as [number, number];
    ctx.lineTo(p[0], p[1]);
  }
  ctx.stroke();
}

export function ringArea(ring: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p = ring[i] as readonly [number, number];
    const q = ring[j] as readonly [number, number];
    a += (q[0] - p[0]) * (q[1] + p[1]);
  }
  return a / 2;
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(y * 10) | 0, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
