import type {
  BuildingInput,
  NeighbourInput,
  PartInput,
  Polygon,
  RoadInput,
  StyleInput,
  Vec2,
} from '@osm-buildingen/core';
import { type LatLon, type LatLonBBox, createProjection } from '@osm-buildingen/osm';
import { type VectorAttributes, partInput, readAttributes } from './attributes';
import {
  type Box,
  GridIndex,
  areaDistance,
  boxesOverlap,
  cleanRing,
  clipPolyline,
  expandBox,
  interiorPoint,
  pointInPolygon,
  pointInRing,
  pointSegmentDist2,
  polylineRingDistance,
  ringBox,
  ringCentroid,
  segmentsCross,
  signedArea,
  withWinding,
} from './geometry';
import { type PoiHit, classifyVector } from './hints';
import { type DecodedTile, type PropertyValue, type TilePoint, featurePolygons } from './mvt';
import { vectorRoadClass } from './roads';
import { vectorBuildingSeed } from './seed';
import { type StitchedPolygon, stitchLayer } from './stitch';
import { tileXToLon, tileYToLat, worldToLatLon } from './tile-math';
import type { VectorBuildStats, VectorBuildingMeta, VectorRoad } from './types';

/** Buildings closer than this (metres) can share a plot group (same as the OSM adapter). */
export const GROUP_DISTANCE = 6;
/** Buildings closer than this are passed as neighbours. */
export const NEIGHBOUR_DISTANCE = 3;
/** Roads closer than this are passed to a building. */
export const ROAD_DISTANCE = 40;
const TOUCH_DISTANCE = 0.5;
const MIN_AREA = 1;
const MIN_PART_AREA = 0.1;
/** An outline without `hide_3d` is kept as a part of its own model when its parts cover less than this share. */
const OWN_PART_COVERAGE = 0.5;
const GRID_CELL = 50;

/** Layer names; defaults are the OpenMapTiles names. */
export interface LayerNames {
  building: string;
  transportation: string;
  housenumber: string;
  poi: string;
  landuse: string;
}

export const OPENMAPTILES_LAYERS: LayerNames = {
  building: 'building',
  transportation: 'transportation',
  housenumber: 'housenumber',
  poi: 'poi',
  landuse: 'landuse',
};

export interface VectorBuildOptions {
  /** Origin of the local metre frame. Default: centre of `bbox`, else of the loaded tiles. */
  origin?: LatLon;
  /** Region and modernity applied to every building. */
  style: StyleInput;
  /** Only emit buildings whose centroid lies inside. Buildings outside still act as neighbours. */
  bbox?: LatLonBBox;
  /** Mixed into every building seed; change it to re-roll a whole town. */
  seed?: string | number;
  /** Passed through to every input (ground-floor store probability). */
  shopProbability?: number;
  /** Most neighbours passed per building, nearest first. Default 16. */
  maxNeighbours?: number;
  /** Most road pieces passed per building, nearest first. Default 12. */
  maxRoads?: number;
  /** Other layer names, for tiles that use the OpenMapTiles schema under different names. */
  layerNames?: Partial<LayerNames>;
  /** Read `render_height` values that match the schema's `levels × 3.66` formula as levels. Default true. */
  levelsHeuristic?: boolean;
}

export interface VectorBuildResult {
  inputs: BuildingInput[];
  /** `meta[i]` describes `inputs[i]`. */
  meta: VectorBuildingMeta[];
  origin: LatLon;
  /** All roads, paths and rail lines in local metres, for drawing. */
  roads: VectorRoad[];
  stats: VectorBuildStats;
}

interface Shape {
  poly: StitchedPolygon;
  outer: Vec2[];
  holes: Vec2[][];
  llOuter: LatLon[];
  llHoles: LatLon[][];
  area: number;
  box: Box;
  centroid: Vec2;
  inside: Vec2;
  attrs: VectorAttributes;
  baseSeed: number;
  parent: number;
}

interface Building {
  shape: Shape;
  parts: Shape[];
  housenumbers: string[];
  pois: PoiHit[];
  landuse: string | undefined;
  touching: number;
  near: [number, number][];
  seed: number;
  group: number;
}

/**
 * Turns decoded OpenMapTiles-schema tiles into generator inputs, mirroring the
 * OSM adapter's `buildInputs`. All tiles must have the same zoom (14 for
 * OpenMapTiles; z13 and below have no heights and merged blocks). Pure and
 * deterministic: the result does not depend on tile or feature order, and
 * seeds do not depend on the origin or on which tile a piece came from.
 */
export function buildInputsFromTiles(
  tiles: readonly DecodedTile[],
  options: VectorBuildOptions,
): VectorBuildResult {
  const names = { ...OPENMAPTILES_LAYERS, ...options.layerNames };
  const z = tiles[0]?.z ?? 0;
  if (tiles.some((t) => t.z !== z)) throw new Error('All tiles must have the same zoom');
  const stats: VectorBuildStats = {
    tiles: tiles.length,
    zoom: z,
    polygonsRead: 0,
    stitched: 0,
    truncated: 0,
    skippedTiny: 0,
    skippedOutside: 0,
    parts: 0,
    defaultHeight: 0,
  };
  const extent = tiles.find((t) => t.layers[names.building])?.layers[names.building]?.extent ?? 4096;
  const origin = options.origin ?? defaultOrigin(tiles, options.bbox);
  const proj = createProjection(origin);
  const loaded = new Set(tiles.map((t) => `${t.x}/${t.y}`));
  const toLatLon = (p: Vec2): LatLon => worldToLatLon(p[0], -p[1], z, extent);
  const toLocal = (ll: LatLon): Vec2 => proj.project(ll.lat, ll.lon);
  const levelsHeuristic = options.levelsHeuristic ?? true;

  // --- Footprints ------------------------------------------------------------------------
  const stitched = stitchLayer(tiles, names.building, extent);
  stats.polygonsRead = stitched.read;
  stats.stitched = stitched.merged;
  const shapes: Shape[] = [];
  for (const poly of stitched.polygons) {
    const llOuter = poly.outer.map(toLatLon);
    const outer = withWinding(cleanRing(llOuter.map(toLocal)), true);
    if (outer.length < 3) {
      stats.skippedTiny++;
      continue;
    }
    let area = signedArea(outer);
    const holes: Vec2[][] = [];
    const llHoles: LatLon[][] = [];
    for (const h of poly.holes) {
      const ll = h.map(toLatLon);
      const hole = withWinding(cleanRing(ll.map(toLocal)), false);
      if (hole.length < 3 || -signedArea(hole) >= area) continue;
      holes.push(hole);
      llHoles.push(ll);
      area += signedArea(hole);
    }
    if (area < MIN_PART_AREA) {
      stats.skippedTiny++;
      continue;
    }
    shapes.push({
      poly,
      outer,
      holes,
      llOuter,
      llHoles,
      area,
      box: ringBox(outer),
      centroid: ringCentroid(outer),
      inside: interiorPoint(outer),
      attrs: readAttributes(poly.properties, levelsHeuristic),
      baseSeed: vectorBuildingSeed(0, llOuter, llHoles, poly.properties),
      parent: -1,
    });
  }
  // Canonical order: independent of tile and feature order.
  shapes.sort((a, b) => a.baseSeed - b.baseSeed || a.area - b.area);

  // --- Parts: a polygon whose interior point lies in a larger polygon belongs to it --------
  const shapeGrid = new GridIndex(GRID_CELL);
  shapes.forEach((s, i) => shapeGrid.insert(i, s.box));
  const at = (p: Vec2): Box => ({ minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] });
  shapes.forEach((s, i) => {
    let best = -1;
    for (const j of shapeGrid.search(at(s.inside))) {
      const o = shapes[j] as Shape;
      if (j === i || o.area <= s.area * 1.0001) continue;
      if (best >= 0 && o.area >= (shapes[best] as Shape).area) continue;
      if (pointInPolygon(s.inside, o.outer, o.holes)) best = j;
    }
    s.parent = best;
  });
  const root = (i: number): number => {
    let guard = 0;
    while ((shapes[i] as Shape).parent >= 0 && guard++ < shapes.length) i = (shapes[i] as Shape).parent;
    return i;
  };
  const buildingOf = new Map<number, Building>();
  const buildings: Building[] = [];
  shapes.forEach((s, i) => {
    if (s.parent >= 0) return;
    if (s.area < MIN_AREA) {
      stats.skippedTiny++;
      return;
    }
    const b: Building = {
      shape: s,
      parts: [],
      housenumbers: [],
      pois: [],
      landuse: undefined,
      touching: 0,
      near: [],
      seed: 0,
      group: -1,
    };
    buildingOf.set(i, b);
    buildings.push(b);
  });
  shapes.forEach((s, i) => {
    if (s.parent < 0) return;
    const owner = buildingOf.get(root(i));
    owner?.parts.push(s);
  });

  const grid = new GridIndex(GRID_CELL);
  buildings.forEach((b, i) => grid.insert(i, b.shape.box));
  const ownerOf = (p: Vec2): Building | undefined => {
    let owner: Building | undefined;
    for (const i of grid.search(at(p))) {
      const b = buildings[i] as Building;
      if ((!owner || b.shape.area < owner.shape.area) && pointInPolygon(p, b.shape.outer, b.shape.holes)) {
        owner = b;
      }
    }
    return owner;
  };

  // --- Points: house numbers and POIs (each tile's own square only, so buffers do not double them)
  for (const { props, point } of points(tiles, names.housenumber, extent)) {
    const owner = ownerOf(toLocal(toLatLon(point)));
    const hn = props.housenumber;
    if (owner) owner.housenumbers.push(typeof hn === 'string' ? hn : String(hn ?? '?'));
  }
  for (const { props, point } of points(tiles, names.poi, extent)) {
    const owner = ownerOf(toLocal(toLatLon(point)));
    if (!owner) continue;
    const cls = typeof props.class === 'string' ? props.class : '';
    const subclass = typeof props.subclass === 'string' ? props.subclass : '';
    if (cls) owner.pois.push({ cls, subclass });
  }

  // --- Landuse: smallest polygon containing the footprint's interior point ----------------
  const landuse: { cls: string; outer: Vec2[]; holes: Vec2[][]; box: Box; area: number }[] = [];
  for (const tile of tiles) {
    const l = tile.layers[names.landuse];
    if (!l) continue;
    const s = extent / l.extent;
    const local = (ring: readonly TilePoint[]): Vec2[] =>
      ring.map((p) =>
        toLocal(worldToLatLon(tile.x * extent + p[0] * s, tile.y * extent + p[1] * s, z, extent)),
      );
    for (const f of l.features) {
      const cls = f.properties.class;
      if (typeof cls !== 'string') continue;
      for (const poly of featurePolygons(f)) {
        const outer = local(poly.outer);
        landuse.push({
          cls,
          outer,
          holes: poly.holes.map(local),
          box: ringBox(outer),
          area: Math.abs(signedArea(outer)),
        });
      }
    }
  }
  if (landuse.length > 0) {
    for (const b of buildings) {
      let best: (typeof landuse)[number] | undefined;
      for (const l of landuse) {
        if (best && l.area >= best.area) continue;
        if (!boxesOverlap(l.box, at(b.shape.inside))) continue;
        if (pointInPolygon(b.shape.inside, l.outer, l.holes)) best = l;
      }
      b.landuse = best?.cls;
    }
  }

  // --- Pairs within the group distance ---------------------------------------------------
  buildings.forEach((b, i) => {
    const box = expandBox(b.shape.box, GROUP_DISTANCE);
    for (const j of grid.search(box)) {
      if (j <= i) continue;
      const o = buildings[j] as Building;
      if (!boxesOverlap(box, o.shape.box)) continue;
      const d = areaDistance(b.shape.outer, o.shape.outer);
      if (d > GROUP_DISTANCE) continue;
      b.near.push([j, d]);
      o.near.push([i, d]);
      if (d <= TOUCH_DISTANCE) {
        b.touching++;
        o.touching++;
      }
    }
  });

  // --- Seeds and groups ------------------------------------------------------------------
  for (const b of buildings) {
    const s = b.shape;
    b.seed =
      options.seed === undefined || options.seed === 0
        ? s.baseSeed
        : vectorBuildingSeed(options.seed, s.llOuter, s.llHoles, s.poly.properties);
  }
  assignGroups(buildings);
  const leaders = new Map<number, Building>();
  for (const b of buildings) {
    const cur = leaders.get(b.group);
    if (!cur || leaderRank(b, cur) < 0) leaders.set(b.group, b);
  }
  const groupKey = (b: Building): string =>
    `vt-${((leaders.get(b.group) as Building).seed >>> 0).toString(36)}`;

  // --- Roads -----------------------------------------------------------------------------
  const roads: VectorRoad[] = [];
  for (const tile of tiles.slice().sort((a, b) => a.x - b.x || a.y - b.y)) {
    const l = tile.layers[names.transportation];
    if (!l) continue;
    const s = extent / l.extent;
    const has = (dx: number, dy: number): boolean => loaded.has(`${tile.x + dx}/${tile.y + dy}`);
    // Own square on sides with a loaded neighbour, so lines in buffers are not doubled.
    const box: Box = {
      minX: has(-1, 0) ? 0 : Number.NEGATIVE_INFINITY,
      maxX: has(1, 0) ? l.extent : Number.POSITIVE_INFINITY,
      minY: has(0, -1) ? 0 : Number.NEGATIVE_INFINITY,
      maxY: has(0, 1) ? l.extent : Number.POSITIVE_INFINITY,
    };
    for (const f of l.features) {
      if (f.type !== 'line') continue;
      const cls = vectorRoadClass(f.properties);
      if (!cls) continue;
      for (const line of f.geometry) {
        for (const piece of clipPolyline(line, box)) {
          const local = piece.map((p) =>
            toLocal(worldToLatLon(tile.x * extent + p[0] * s, tile.y * extent + p[1] * s, z, extent)),
          );
          const road: VectorRoad = { line: local, width: cls.width, kind: cls.kind, class: cls.class };
          if (cls.brunnel) road.brunnel = cls.brunnel;
          roads.push(road);
        }
      }
    }
  }
  const roadGrid = new GridIndex(GRID_CELL);
  const segRoad: number[] = [];
  const segIndex: number[] = [];
  roads.forEach((r, ri) => {
    for (let k = 0; k + 1 < r.line.length; k++) {
      const a = r.line[k] as Vec2;
      const c = r.line[k + 1] as Vec2;
      roadGrid.insert(segRoad.length, {
        minX: Math.min(a[0], c[0]),
        minY: Math.min(a[1], c[1]),
        maxX: Math.max(a[0], c[0]),
        maxY: Math.max(a[1], c[1]),
      });
      segRoad.push(ri);
      segIndex.push(k);
    }
  });
  const maxRoads = options.maxRoads ?? 12;
  function roadsNear(s: Shape): RoadInput[] {
    const box = expandBox(s.box, ROAD_DISTANCE);
    const segs = roadGrid.search(box);
    const found: { road: RoadInput; distance: number; index: number }[] = [];
    let k = 0;
    while (k < segs.length) {
      const ri = segRoad[segs[k] as number] as number;
      const lo = segIndex[segs[k] as number] as number;
      let hi = lo;
      while (k < segs.length && segRoad[segs[k] as number] === ri) {
        hi = segIndex[segs[k] as number] as number;
        k++;
      }
      const r = roads[ri] as VectorRoad;
      for (const piece of clipPolyline(r.line.slice(lo, hi + 2), box)) {
        const distance =
          piece.length > 0 && pointInRing(piece[0] as Vec2, s.outer)
            ? 0
            : polylineRingDistance(piece, s.outer);
        if (distance > ROAD_DISTANCE) continue;
        const road: RoadInput = { line: piece, width: r.width, kind: r.kind };
        if (r.brunnel !== 'bridge' && crossesInterior(piece, s)) road.passage = true;
        found.push({ road, distance, index: ri });
      }
    }
    found.sort((x, y) => Math.round(x.distance * 100) - Math.round(y.distance * 100) || x.index - y.index);
    return found.slice(0, maxRoads).map((f) => f.road);
  }

  // --- Inputs ----------------------------------------------------------------------------
  const inputs: BuildingInput[] = [];
  const meta: VectorBuildingMeta[] = [];
  const maxNeighbours = options.maxNeighbours ?? 16;
  const heightOf = (b: Building): number | undefined => {
    let max = b.shape.attrs.estimate;
    for (const p of b.parts) {
      const h = p.attrs.estimate;
      if (h !== undefined && (max === undefined || h > max)) max = h;
    }
    return max;
  };

  for (const b of buildings) {
    const s = b.shape;
    const centroidLatLon = proj.unproject(s.centroid[0], s.centroid[1]);
    if (options.bbox && !inBBox(centroidLatLon, options.bbox)) {
      stats.skippedOutside++;
      continue;
    }
    if (s.poly.truncated) stats.truncated++;
    stats.parts += b.parts.length;
    const a = s.attrs;
    if (a.heightSource === 'default') stats.defaultHeight++;
    const cls = classifyVector({
      area: s.area,
      pois: b.pois,
      landuse: b.landuse,
      levels: a.levels,
      height: a.estimate,
      denseRow: b.touching >= 2,
    });
    const input: BuildingInput = {
      footprint: polygon(s),
      style: options.style,
      seed: b.seed,
      groupKey: groupKey(b),
    };
    if (b.parts.length > 0) {
      const parts: PartInput[] = b.parts.map((p) => partInput(polygon(p), p.attrs));
      const covered = b.parts.reduce((sum, p) => sum + p.area, 0);
      // Outlines of type=building relations carry hide_3d; other outlines are kept as their own part
      // unless the parts cover most of them (the tiles cannot tell outline from outline+part).
      if (s.poly.properties.hide_3d !== true && covered < s.area * OWN_PART_COVERAGE) {
        parts.unshift(partInput(polygon(s), a));
      }
      input.parts = parts;
    }
    if (cls.type) input.type = cls.type;
    if (a.height !== undefined) input.height = a.height;
    if (a.levels !== undefined) input.levels = a.levels;
    if (a.minHeight !== undefined) input.minHeight = a.minHeight;
    if (a.colours) input.colours = a.colours;
    if (b.housenumbers.length > 0) input.hasAddress = true;
    if (cls.shop) input.shop = true;
    if (options.shopProbability !== undefined) input.shopProbability = options.shopProbability;

    const neighbours = b.near
      .filter(([, d]) => d <= NEIGHBOUR_DISTANCE)
      .sort((x, y) => x[1] - y[1] || x[0] - y[0])
      .slice(0, maxNeighbours)
      .map(([j]): NeighbourInput => {
        const o = buildings[j] as Building;
        const nb: NeighbourInput = { footprint: { outer: o.shape.outer } };
        const h = heightOf(o);
        if (h !== undefined) nb.height = h;
        if (o.group === b.group) nb.sameGroup = true;
        return nb;
      });
    if (neighbours.length > 0) input.neighbours = neighbours;
    const near = roadsNear(s);
    if (near.length > 0) input.roads = near;
    if (cls.special) input.detail = 'massing';

    inputs.push(input);
    const m: VectorBuildingMeta = {
      key: (s.baseSeed >>> 0).toString(36),
      properties: s.poly.properties,
      tiles: s.poly.tiles,
      stitched: s.poly.stitched,
      truncated: s.poly.truncated,
      centroid: s.centroid,
      centroidLatLon,
      area: s.area,
      special: cls.special !== undefined,
      type: cls.type,
      typeReason: cls.reason,
      heightSource: a.heightSource,
      groupKey: input.groupKey as string,
      parts: input.parts?.length ?? 0,
      housenumbers: b.housenumbers.slice().sort(),
      pois: b.pois.map((p) => (p.subclass && p.subclass !== p.cls ? `${p.cls}/${p.subclass}` : p.cls)).sort(),
      landuse: b.landuse,
    };
    if (s.poly.featureId !== undefined) m.featureId = s.poly.featureId;
    meta.push(m);
  }

  return { inputs, meta, origin: { lat: origin.lat, lon: origin.lon }, roads, stats };
}

function polygon(s: Shape): Polygon {
  return s.holes.length > 0 ? { outer: s.outer, holes: s.holes } : { outer: s.outer };
}

/** Points of a layer, each tile restricted to its own square (half-open) so buffer copies are skipped. */
function* points(
  tiles: readonly DecodedTile[],
  layer: string,
  extent: number,
): Generator<{ props: Record<string, PropertyValue>; point: Vec2 }> {
  const sorted = tiles.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  for (const tile of sorted) {
    const l = tile.layers[layer];
    if (!l) continue;
    const s = extent / l.extent;
    for (const f of l.features) {
      if (f.type !== 'point') continue;
      for (const group of f.geometry) {
        for (const p of group) {
          if (p[0] < 0 || p[1] < 0 || p[0] >= l.extent || p[1] >= l.extent) continue;
          yield {
            props: f.properties,
            point: [tile.x * extent + p[0] * s, -(tile.y * extent + p[1] * s)],
          };
        }
      }
    }
  }
}

function defaultOrigin(tiles: readonly DecodedTile[], bbox: LatLonBBox | undefined): LatLon {
  if (bbox) return { lat: (bbox.minLat + bbox.maxLat) / 2, lon: (bbox.minLon + bbox.maxLon) / 2 };
  if (tiles.length === 0) return { lat: 0, lon: 0 };
  const z = (tiles[0] as DecodedTile).z;
  const minX = Math.min(...tiles.map((t) => t.x));
  const maxX = Math.max(...tiles.map((t) => t.x)) + 1;
  const minY = Math.min(...tiles.map((t) => t.y));
  const maxY = Math.max(...tiles.map((t) => t.y)) + 1;
  return { lat: tileYToLat((minY + maxY) / 2, z), lon: tileXToLon((minX + maxX) / 2, z) };
}

const inBBox = (p: LatLon, b: LatLonBBox): boolean =>
  p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;

/** Negative when `a` should lead the group rather than `b`. */
function leaderRank(a: Building, b: Building): number {
  const aa = a.housenumbers.length > 0;
  const ba = b.housenumbers.length > 0;
  if (aa !== ba) return aa ? -1 : 1;
  return b.shape.area - a.shape.area || a.shape.baseSeed - b.shape.baseSeed;
}

/**
 * Plot groups, as in the OSM adapter: union buildings closer than GROUP_DISTANCE,
 * nearest pairs first, never merging two groups that both contain an addressed
 * building (house number inside the footprint).
 */
function assignGroups(buildings: Building[]): void {
  const parent = buildings.map((_, i) => i);
  const addresses = buildings.map((b): number => (b.housenumbers.length > 0 ? 1 : 0));
  const find = (i: number): number => {
    while (parent[i] !== i) {
      const p = parent[parent[i] as number] as number;
      parent[i] = p;
      i = p;
    }
    return i;
  };
  const pairs: [number, number, number][] = [];
  buildings.forEach((b, i) => {
    for (const [j, d] of b.near) if (j > i) pairs.push([i, j, Math.round(d * 1000)]);
  });
  pairs.sort((x, y) => x[2] - y[2] || x[0] - y[0] || x[1] - y[1]);
  for (const [i, j] of pairs) {
    const a = find(i);
    const b = find(j);
    if (a === b) continue;
    const total = (addresses[a] as number) + (addresses[b] as number);
    if (total > 1) continue;
    const r = Math.min(a, b);
    parent[Math.max(a, b)] = r;
    addresses[r] = total;
  }
  buildings.forEach((b, i) => {
    b.group = find(i);
  });
}

/** True when part of the polyline runs through the footprint's interior (not just along an edge). */
function crossesInterior(line: readonly Vec2[], s: Shape): boolean {
  const rings = [s.outer, ...s.holes];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const ts = [0, 1];
    for (const ring of rings) {
      for (let k = 0, n = ring.length; k < n; k++) {
        const c = ring[k] as Vec2;
        const d = ring[(k + 1) % n] as Vec2;
        if (!segmentsCross(a, b, c, d)) continue;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const ex = d[0] - c[0];
        const ey = d[1] - c[1];
        const den = dx * ey - dy * ex;
        if (den !== 0) ts.push(((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den);
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t = ((ts[k] as number) + (ts[k + 1] as number)) / 2;
      const m: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!pointInPolygon(m, s.outer, s.holes)) continue;
      let clear = true;
      for (const ring of rings) {
        for (let q = 0, n = ring.length; q < n && clear; q++) {
          if (pointSegmentDist2(m, ring[q] as Vec2, ring[(q + 1) % n] as Vec2) < 0.01) clear = false;
        }
      }
      if (clear) return true;
    }
  }
  return false;
}
