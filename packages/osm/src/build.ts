import {
  type BuildingInput,
  type NeighbourInput,
  type PartInput,
  type Polygon,
  type RoadInput,
  type StyleInput,
  type Vec2,
  seedFrom,
} from '@osm-buildingen/core';
import { type Attributes, estimateHeight, partInput, readAttributes } from './attributes';
import {
  SHOP_NODE_AMENITY,
  WORSHIP_ARCHITECTURE,
  classify,
  faithOf,
  skipReason,
  specialReason,
} from './classify';
import {
  type Box,
  GridIndex,
  areaDistance,
  assembleRings,
  boxesOverlap,
  cleanRing,
  clipPolyline,
  expandBox,
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
import { type Projection, createProjection } from './projection';
import { roadClass } from './roads';
import { buildingSeed } from './seed';
import type {
  BuildStats,
  BuildingMeta,
  LatLon,
  LatLonBBox,
  MapRoad,
  OsmData,
  OsmElementType,
  OsmNode,
  OsmWay,
  Tags,
} from './types';

/** Buildings closer than this (metres) can share a plot group. */
export const GROUP_DISTANCE = 6;
/** Buildings closer than this are passed as neighbours. */
export const NEIGHBOUR_DISTANCE = 3;
/** Roads closer than this are passed to a building. */
export const ROAD_DISTANCE = 40;
/** Buildings closer than this touch (dense-row detection). */
const TOUCH_DISTANCE = 0.5;
/** Footprints below this area are dropped; core rejects < 0.5 m². */
const MIN_AREA = 1;
/** Parts can be much smaller than buildings (pillars, turrets). */
const MIN_PART_AREA = 0.1;
const GRID_CELL = 50;

export interface BuildOptions {
  /** Origin of the local metre frame. Default: centre of `data.bounds`, else of all nodes. */
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
}

export interface BuildResult {
  inputs: BuildingInput[];
  /** `meta[i]` describes `inputs[i]`. */
  meta: BuildingMeta[];
  origin: LatLon;
  /** All roads, paths and rail lines in local metres, for drawing. */
  roads: MapRoad[];
  stats: BuildStats;
}

interface Shape {
  osmType: OsmElementType;
  osmId: number;
  ring: number;
  tags: Tags;
  outerIds: number[];
  holeIds: number[][];
  outer: Vec2[];
  holes: Vec2[][];
  box: Box;
  area: number;
  centroid: Vec2;
}

interface Building {
  shape: Shape;
  attrs: Attributes;
  special: string | undefined;
  hasAddress: boolean;
  shopSource: string | undefined;
  parts: Shape[];
  touching: number;
  seed: number;
  /** [other building index, distance] within GROUP_DISTANCE. */
  near: [number, number][];
  group: number;
}

const isBuildingValue = (v: string | undefined): v is string => v !== undefined && v !== 'no';

/**
 * Turns parsed OSM data into generator inputs. Pure and deterministic: the
 * result does not depend on element order, and building seeds do not depend
 * on the origin.
 */
export function buildInputs(data: OsmData, options: BuildOptions): BuildResult {
  const stats: BuildStats = { skippedIncomplete: 0, skippedOutside: 0, skippedByTag: 0, orphanParts: 0 };
  const nodes = new Map<number, OsmNode>();
  for (const n of data.nodes) nodes.set(n.id, n);
  const ways = new Map<number, OsmWay>();
  for (const w of data.ways) ways.set(w.id, w);

  const origin = options.origin ?? defaultOrigin(data);
  const proj = createProjection(origin);
  const projected = new Map<number, Vec2>();
  const point = (id: number): Vec2 | undefined => {
    let p = projected.get(id);
    if (p) return p;
    const n = nodes.get(id);
    if (!n) return undefined;
    p = proj.project(n.lat, n.lon);
    projected.set(id, p);
    return p;
  };

  // --- Collect building and part shapes -------------------------------------------------
  const buildingShapes: Shape[] = [];
  const partShapes: Shape[] = [];
  const skipWays = new Set<number>();
  const extraHoles = new Map<number, number[][]>();
  const explicitParts = new Map<string, string>(); // part key -> outline key (type=building relations)

  const relations = data.relations.slice().sort((a, b) => a.id - b.id);
  for (const rel of relations) {
    const t = rel.tags;
    if (t.type === 'building') {
      const outline = rel.members.find((m) => m.role === 'outline' && m.type !== 'node');
      if (!outline) continue;
      for (const m of rel.members) {
        if (m.role === 'part' && m.type !== 'node') {
          explicitParts.set(`${m.type}/${m.ref}`, `${outline.type}/${outline.ref}`);
        }
      }
      continue;
    }
    if (t.type !== 'multipolygon') continue;
    const isBuilding = isBuildingValue(t.building);
    const isPart = !isBuilding && isBuildingValue(t['building:part']);
    const outerWays: number[][] = [];
    const innerWays: number[][] = [];
    for (const m of rel.members) {
      if (m.type !== 'way') continue;
      const w = ways.get(m.ref);
      if (!w) continue;
      if (m.role === 'inner') innerWays.push(w.nodes);
      else if (m.role === 'outer' || m.role === '') {
        outerWays.push(w.nodes);
        if (isBuilding) skipWays.add(w.id);
      }
    }
    if (!isBuilding && !isPart) {
      // Old-style multipolygon: building tags on the outer way, holes from the relation.
      const inner = assembleRings(innerWays).map((r) => r.slice(0, -1));
      if (inner.length === 0) continue;
      for (const m of rel.members) {
        const w = m.type === 'way' && m.role === 'outer' ? ways.get(m.ref) : undefined;
        if (w && isBuildingValue(w.tags.building) && w.nodes[0] === w.nodes[w.nodes.length - 1]) {
          extraHoles.set(w.id, [...(extraHoles.get(w.id) ?? []), ...inner]);
        }
      }
      continue;
    }
    if (skipReason(t)) {
      stats.skippedByTag++;
      continue;
    }
    const outers = assembleRings(outerWays)
      .map((r) => r.slice(0, -1))
      .sort((a, b) => Math.min(...a) - Math.min(...b));
    const inners = assembleRings(innerWays).map((r) => r.slice(0, -1));
    if (outers.length === 0) {
      stats.skippedIncomplete++;
      continue;
    }
    outers.forEach((outerIds, ring) => {
      const shape = makeShape('relation', rel.id, ring, t, outerIds, inners, true, isPart);
      if (!shape) stats.skippedIncomplete++;
      else (isBuilding ? buildingShapes : partShapes).push(shape);
    });
  }

  const wayList = data.ways.slice().sort((a, b) => a.id - b.id);
  for (const w of wayList) {
    const t = w.tags;
    const isBuilding = isBuildingValue(t.building);
    const isPart = !isBuilding && isBuildingValue(t['building:part']);
    if (!isBuilding && !isPart) continue;
    if (skipWays.has(w.id)) continue;
    const ids = w.nodes;
    if (ids.length < 4 || ids[0] !== ids[ids.length - 1]) {
      if (isBuilding) stats.skippedIncomplete++;
      continue;
    }
    if (skipReason(t)) {
      if (isBuilding) stats.skippedByTag++;
      continue;
    }
    const shape = makeShape('way', w.id, 0, t, ids.slice(0, -1), extraHoles.get(w.id) ?? [], false, isPart);
    if (!shape) {
      if (isBuilding) stats.skippedIncomplete++;
      continue;
    }
    if (isBuilding) {
      buildingShapes.push(shape);
      // An outline that is also tagged as a part is part of its own 3D model.
      if (isBuildingValue(t['building:part'])) partShapes.push(shape);
    } else partShapes.push(shape);
  }

  function makeShape(
    osmType: OsmElementType,
    osmId: number,
    ring: number,
    tags: Tags,
    outerIds: number[],
    innerIds: number[][],
    filterHoles: boolean,
    isPart: boolean,
  ): Shape | null {
    const minArea = isPart ? MIN_PART_AREA : MIN_AREA;
    const raw: Vec2[] = [];
    for (const id of outerIds) {
      const p = point(id);
      if (!p) return null;
      raw.push(p);
    }
    const outer = withWinding(cleanRing(raw), true);
    if (outer.length < 3) return null;
    let area = signedArea(outer);
    if (area < minArea) return null;
    const holes: Vec2[][] = [];
    const holeIds: number[][] = [];
    for (const ids of innerIds) {
      const pts: Vec2[] = [];
      for (const id of ids) {
        const p = point(id);
        if (!p) break;
        pts.push(p);
      }
      if (pts.length !== ids.length) continue;
      const hole = withWinding(cleanRing(pts), false);
      if (hole.length < 3) continue;
      // Holes belong to the outer ring that contains them (relations with several outers).
      if (filterHoles && !pointInRing(ringCentroidInside(hole), outer)) continue;
      const holeArea = -signedArea(hole);
      if (holeArea >= area) continue;
      holes.push(hole);
      holeIds.push(ids);
      area -= holeArea;
    }
    if (area < minArea) return null;
    return {
      osmType,
      osmId,
      ring,
      tags,
      outerIds,
      holeIds,
      outer,
      holes,
      box: ringBox(outer),
      area,
      centroid: ringCentroid(outer),
    };
  }

  // --- Buildings, in canonical order --------------------------------------------------
  buildingShapes.sort(compareShapes);
  const buildings: Building[] = buildingShapes.map((shape) => ({
    shape,
    attrs: readAttributes(shape.tags),
    special: specialReason(shape.tags),
    hasAddress: shape.tags['addr:housenumber'] !== undefined,
    shopSource: shopTag(shape.tags),
    parts: [],
    touching: 0,
    seed: 0,
    near: [],
    group: -1,
  }));
  const grid = new GridIndex(GRID_CELL);
  buildings.forEach((b, i) => grid.insert(i, b.shape.box));
  const byKey = new Map<string, number>();
  buildings.forEach((b, i) => byKey.set(`${b.shape.osmType}/${b.shape.osmId}`, i));

  // Address on an outline vertex (entrance node with address).
  for (const b of buildings) {
    if (b.hasAddress) continue;
    for (const id of b.shape.outerIds) {
      if (nodes.get(id)?.tags?.['addr:housenumber'] !== undefined) {
        b.hasAddress = true;
        break;
      }
    }
  }

  // --- Parts -----------------------------------------------------------------------------
  partShapes.sort(compareShapes);
  for (const part of partShapes) {
    const explicit = explicitParts.get(`${part.osmType}/${part.osmId}`);
    let owner = explicit !== undefined ? byKey.get(explicit) : undefined;
    if (owner === undefined) {
      const p = ringCentroidInside(part.outer);
      let best = Number.POSITIVE_INFINITY;
      for (const i of grid.search({ minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] })) {
        const b = buildings[i] as Building;
        if (b.shape === part) {
          owner = i;
          break;
        }
        if (b.shape.area < best && pointInPolygon(p, b.shape.outer, b.shape.holes)) {
          best = b.shape.area;
          owner = i;
        }
      }
    }
    if (owner === undefined) stats.orphanParts++;
    else (buildings[owner] as Building).parts.push(part);
  }
  for (const b of buildings) {
    // A self-part alone carries no information.
    if (b.parts.length === 1 && b.parts[0] === b.shape) b.parts = [];
  }

  // --- Address and shop nodes inside footprints ----------------------------------------
  const sortedNodes = data.nodes.filter((n) => n.tags).sort((a, b) => a.id - b.id);
  for (const n of sortedNodes) {
    const tags = n.tags as Tags;
    const addr = tags['addr:housenumber'] !== undefined;
    const shop = shopTag(tags);
    if (!addr && !shop) continue;
    const p = point(n.id) as Vec2;
    let owner: Building | undefined;
    for (const i of grid.search({ minX: p[0], minY: p[1], maxX: p[0], maxY: p[1] })) {
      const b = buildings[i] as Building;
      if ((!owner || b.shape.area < owner.shape.area) && pointInPolygon(p, b.shape.outer, b.shape.holes)) {
        owner = b;
      }
    }
    if (!owner) continue;
    if (addr) owner.hasAddress = true;
    if (shop && !owner.shopSource) owner.shopSource = `${shop} node`;
  }

  // --- Pairs within the group distance -------------------------------------------------
  buildings.forEach((b, i) => {
    for (const j of grid.search(expandBox(b.shape.box, GROUP_DISTANCE))) {
      if (j <= i) continue;
      const o = buildings[j] as Building;
      if (!boxesOverlap(expandBox(b.shape.box, GROUP_DISTANCE), o.shape.box)) continue;
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

  // --- Seeds ---------------------------------------------------------------------------
  for (const b of buildings) b.seed = buildingSeed(options.seed ?? 0, b.shape, nodes);

  // --- Groups --------------------------------------------------------------------------
  assignGroups(buildings);
  const leaders = new Map<number, Building>();
  for (const b of buildings) {
    const cur = leaders.get(b.group);
    if (!cur || leaderRank(b, cur) < 0) leaders.set(b.group, b);
  }
  const groupKey = (b: Building): string =>
    `osm-${((leaders.get(b.group) as Building).seed >>> 0).toString(36)}`;

  // --- Roads ---------------------------------------------------------------------------
  const roads: MapRoad[] = [];
  for (const w of wayList) {
    const cls = roadClass(w.tags);
    if (!cls) continue;
    // Split at missing nodes so partial ways (cut extracts) still contribute.
    let line: Vec2[] = [];
    const flush = (): void => {
      if (line.length >= 2) {
        roads.push({
          osmId: w.id,
          line,
          width: cls.width,
          kind: cls.kind,
          class: cls.class,
          ...(cls.passage ? { passage: true } : {}),
          ...(cls.covered ? { covered: cls.covered } : {}),
        });
      }
      line = [];
    };
    for (const id of w.nodes) {
      const p = point(id);
      if (p) line.push(p);
      else flush();
    }
    flush();
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

  // --- Inputs --------------------------------------------------------------------------
  const inputs: BuildingInput[] = [];
  const meta: BuildingMeta[] = [];
  const maxNeighbours = options.maxNeighbours ?? 16;
  const maxRoads = options.maxRoads ?? 12;
  const heightOf = (b: Building): number | undefined => {
    const own = estimateHeight(b.attrs);
    if (own !== undefined) return own;
    let max: number | undefined;
    for (const p of b.parts) {
      const h = estimateHeight(readAttributes(p.tags));
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

    const cls = b.special
      ? { type: undefined, reason: `special: ${b.special}` }
      : classify(s.tags, {
          area: s.area,
          levels: b.attrs.rawLevels,
          shopSource: b.shopSource,
          denseRow: b.touching >= 2,
        });

    const input: BuildingInput = {
      footprint: polygon(s),
      style: options.style,
      seed: b.seed,
      groupKey: groupKey(b),
    };
    if (b.parts.length > 0) {
      input.parts = b.parts.map((p): PartInput => partInput(polygon(p), readAttributes(p.tags)));
    }
    if (cls.type) input.type = cls.type;
    const architecture = WORSHIP_ARCHITECTURE[s.tags['building:architecture'] ?? ''];
    if (cls.type === 'worship' && architecture) input.facadeVariant = architecture;
    const faith = cls.type === 'worship' ? faithOf(s.tags) : undefined;
    if (faith) input.faith = faith;
    const a = b.attrs;
    if (a.height !== undefined) input.height = a.height;
    if (a.levels !== undefined) input.levels = a.levels;
    if (a.minHeight !== undefined) input.minHeight = a.minHeight;
    if (a.roof) input.roof = a.roof;
    if (a.colours) input.colours = a.colours;
    if (a.year !== undefined) input.year = a.year;
    if (b.hasAddress) input.hasAddress = true;
    if ('shop' in cls && cls.shop) input.shop = true;
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

    const nearRoads = roadsNear(s);
    if (nearRoads.length > 0) input.roads = nearRoads;
    if (b.special) input.detail = 'massing';

    inputs.push(input);
    meta.push({
      osmType: s.osmType,
      osmId: s.osmId,
      ring: s.ring,
      tags: s.tags,
      centroid: s.centroid,
      centroidLatLon,
      area: s.area,
      special: b.special !== undefined,
      type: cls.type,
      typeReason: cls.reason,
      groupKey: input.groupKey as string,
      partIds: b.parts.map((p) => p.osmId),
    });
  }

  function roadsNear(s: Shape): RoadInput[] {
    const box = expandBox(s.box, ROAD_DISTANCE);
    const segs = roadGrid.search(box);
    if (segs.length === 0) return [];
    // segs is ascending, and segment ids were assigned road by road, so each road's segments are contiguous.
    const found: { road: RoadInput; distance: number; osmId: number }[] = [];
    let k = 0;
    while (k < segs.length) {
      const ri = segRoad[segs[k] as number] as number;
      let lo = segIndex[segs[k] as number] as number;
      let hi = lo;
      while (k < segs.length && segRoad[segs[k] as number] === ri) {
        hi = segIndex[segs[k] as number] as number;
        k++;
      }
      const r = roads[ri] as MapRoad;
      lo = Math.max(0, lo);
      for (const piece of clipPolyline(r.line.slice(lo, hi + 2), box)) {
        const distance = pieceDistance(piece, s);
        if (distance > ROAD_DISTANCE) continue;
        const road: RoadInput = { line: piece, width: r.width, kind: r.kind };
        if (r.covered) road.covered = r.covered;
        const crosses = crossesInterior(piece, s);
        if (crosses || (r.passage && distance < 1)) road.passage = true;
        found.push({ road, distance, osmId: r.osmId });
      }
    }
    // Passages first: around a big block many roads touch the outline at distance 0, and the
    // cap must not drop the ones that go through it.
    found.sort(
      (x, y) =>
        through(x) - through(y) ||
        Math.round(x.distance * 100) - Math.round(y.distance * 100) ||
        x.osmId - y.osmId,
    );
    return found.slice(0, maxRoads).map((f) => f.road);
  }

  return { inputs, meta, origin: { lat: origin.lat, lon: origin.lon }, roads, stats };
}

function polygon(s: Shape): Polygon {
  return s.holes.length > 0 ? { outer: s.outer, holes: s.holes } : { outer: s.outer };
}

function shopTag(tags: Tags): string | undefined {
  if (tags.shop !== undefined && tags.shop !== 'no' && tags.shop !== 'vacant') return `shop=${tags.shop}`;
  if (tags.amenity !== undefined && SHOP_NODE_AMENITY.has(tags.amenity)) return `amenity=${tags.amenity}`;
  return undefined;
}

function compareShapes(a: Shape, b: Shape): number {
  if (a.osmType !== b.osmType) return a.osmType === 'way' ? -1 : 1;
  return a.osmId - b.osmId || a.ring - b.ring;
}

/** Negative when `a` should lead the group rather than `b`. */
function leaderRank(a: Building, b: Building): number {
  if (a.hasAddress !== b.hasAddress) return a.hasAddress ? -1 : 1;
  return b.shape.area - a.shape.area || compareShapes(a.shape, b.shape);
}

/**
 * Plot groups: union buildings closer than GROUP_DISTANCE, nearest pairs first,
 * never merging two groups that both contain an addressed building. Pairs are
 * ordered by quantised distance and canonical index, so the result is the
 * same for any input order.
 */
function assignGroups(buildings: Building[]): void {
  const parent = buildings.map((_, i) => i);
  const addresses = buildings.map((b): number => (b.hasAddress ? 1 : 0));
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
    const root = Math.min(a, b);
    parent[Math.max(a, b)] = root;
    addresses[root] = total;
  }
  buildings.forEach((b, i) => {
    b.group = find(i);
  });
}

function defaultOrigin(data: OsmData): LatLon {
  const b = data.bounds;
  if (b) return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const n of data.nodes) {
    if (n.lat < minLat) minLat = n.lat;
    if (n.lat > maxLat) maxLat = n.lat;
    if (n.lon < minLon) minLon = n.lon;
    if (n.lon > maxLon) maxLon = n.lon;
  }
  if (!Number.isFinite(minLat)) return { lat: 0, lon: 0 };
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

const inBBox = (p: LatLon, b: LatLonBBox): boolean =>
  p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;

/** A point inside the ring: the centroid if it is inside, else the centre of an inside ear. */
function ringCentroidInside(ring: readonly Vec2[]): Vec2 {
  const c = ringCentroid(ring);
  if (pointInRing(c, ring)) return c;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n] as Vec2;
    const b = ring[i] as Vec2;
    const d = ring[(i + 1) % n] as Vec2;
    const p: Vec2 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3];
    if (pointInRing(p, ring)) return p;
  }
  return c;
}

/** 0 for a road piece that goes through the building (or is mapped as covered by it), else 1. */
function through(f: { road: RoadInput; distance: number }): number {
  return f.road.passage || (f.road.covered !== undefined && f.distance < 1) ? 0 : 1;
}

function pieceDistance(piece: readonly Vec2[], s: Shape): number {
  if (piece.length > 0 && pointInRing(piece[0] as Vec2, s.outer)) return 0;
  return polylineRingDistance(piece, s.outer);
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
      // Ignore paths that run along a wall: require some clearance from the boundary.
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
