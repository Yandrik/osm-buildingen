import { PbfError, PbfReader, WIRE_BYTES } from './pbf';

/*
 * Mapbox Vector Tile 2.1 decoder
 * (https://github.com/mapbox/vector-tile-spec/tree/master/2.1). Output is plain
 * arrays and objects, so a decoded tile can be posted to a worker.
 */

export type PropertyValue = string | number | boolean;
export type GeometryType = 'point' | 'line' | 'polygon';
/** Point in tile units: x right, y DOWN, 0..extent inside the tile (buffer goes beyond). */
export type TilePoint = [number, number];

export interface TileFeature {
  /** MVT feature id, when the tile has one (OpenMapTiles z14 buildings usually do not). */
  id?: number;
  type: GeometryType;
  /** Created without a prototype, so keys like `__proto__` are plain data. */
  properties: Record<string, PropertyValue>;
  /**
   * Points: one array with all points. Lines: one array per line. Polygons: one
   * array per ring in file order (exterior rings followed by their holes), open
   * (the closing point is not repeated).
   */
  geometry: TilePoint[][];
}

export interface TileLayer {
  name: string;
  /** Tile units per tile edge, usually 4096. */
  extent: number;
  version: number;
  features: TileFeature[];
}

/** A decoded tile with its address. */
export interface DecodedTile {
  z: number;
  x: number;
  y: number;
  layers: Record<string, TileLayer>;
}

export interface DecodeOptions {
  /** Only decode these layers; others are skipped without parsing their features. */
  layers?: readonly string[];
}

/** A polygon in tile units: exterior ring and its holes, as stored (exterior has positive area, y down). */
export interface TilePolygon {
  outer: TilePoint[];
  holes: TilePoint[][];
}

const GEOM_TYPES: readonly (GeometryType | undefined)[] = [undefined, 'point', 'line', 'polygon'];

/**
 * Decodes an uncompressed MVT buffer. Gzip must be removed first (`fetch` does
 * that when the server sends `Content-Encoding: gzip`). Throws `PbfError` on
 * malformed data. Features of unknown geometry type are dropped.
 */
export function decodeTile(
  bytes: Uint8Array,
  z: number,
  x: number,
  y: number,
  options: DecodeOptions = {},
): DecodedTile {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    throw new PbfError('Tile is gzip-compressed; decompress it before decoding');
  }
  const wanted = options.layers ? new Set(options.layers) : null;
  const layers: Record<string, TileLayer> = Object.create(null);
  const r = new PbfReader(bytes);
  while (r.more()) {
    const [field, wire] = r.key();
    if (field === 3 && wire === WIRE_BYTES) {
      const [start, end] = r.bytes();
      const name = layerName(bytes, start, end);
      if (wanted && !wanted.has(name)) continue;
      const layer = decodeLayer(bytes, start, end);
      // Duplicate layer names are invalid MVT; keep the first.
      if (!(layer.name in layers)) layers[layer.name] = layer;
    } else r.skip(wire);
  }
  return { z, x, y, layers };
}

function layerName(buf: Uint8Array, start: number, end: number): string {
  const r = new PbfReader(buf, start, end);
  while (r.more()) {
    const [field, wire] = r.key();
    if (field === 1 && wire === WIRE_BYTES) return r.string();
    r.skip(wire);
  }
  throw new PbfError('Layer without a name');
}

function decodeLayer(buf: Uint8Array, start: number, end: number): TileLayer {
  const r = new PbfReader(buf, start, end);
  let name = '';
  let extent = 4096;
  let version = 1;
  const keys: string[] = [];
  const values: PropertyValue[] = [];
  const raw: [number, number][] = [];
  while (r.more()) {
    const [field, wire] = r.key();
    if (field === 1 && wire === WIRE_BYTES) name = r.string();
    else if (field === 2 && wire === WIRE_BYTES) raw.push(r.bytes());
    else if (field === 3 && wire === WIRE_BYTES) keys.push(r.string());
    else if (field === 4 && wire === WIRE_BYTES) values.push(decodeValue(r));
    else if (field === 5 && wire === 0) extent = r.varint();
    else if (field === 15 && wire === 0) version = r.varint();
    else r.skip(wire);
  }
  if (!(extent > 0)) throw new PbfError(`Layer ${name} has extent ${extent}`);
  const features: TileFeature[] = [];
  // Features reference keys and values by index, and those may come after the features.
  for (const [s, e] of raw) {
    const f = decodeFeature(buf, s, e, keys, values);
    if (f) features.push(f);
  }
  return { name, extent, version, features };
}

function decodeValue(outer: PbfReader): PropertyValue {
  const [start, end] = outer.bytes();
  const r = new PbfReader(outer.buf, start, end);
  let value: PropertyValue = '';
  while (r.more()) {
    const [field, wire] = r.key();
    if (field === 1) value = r.string();
    else if (field === 2) value = r.float();
    else if (field === 3) value = r.double();
    else if (field === 4) value = r.int64();
    else if (field === 5) value = r.varint();
    else if (field === 6) value = r.svarint();
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

function decodeFeature(
  buf: Uint8Array,
  start: number,
  end: number,
  keys: readonly string[],
  values: readonly PropertyValue[],
): TileFeature | null {
  const r = new PbfReader(buf, start, end);
  let id: number | undefined;
  let type: GeometryType | undefined;
  let tags: number[] = [];
  let commands: number[] = [];
  while (r.more()) {
    const [field, wire] = r.key();
    if (field === 1 && wire === 0) id = r.varint();
    else if (field === 2 && wire === WIRE_BYTES) tags = r.packedVarints();
    else if (field === 3 && wire === 0) type = GEOM_TYPES[r.varint()];
    else if (field === 4 && wire === WIRE_BYTES) commands = r.packedVarints();
    else r.skip(wire);
  }
  if (!type) return null;
  const properties: Record<string, PropertyValue> = Object.create(null);
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const k = keys[tags[i] as number];
    const v = values[tags[i + 1] as number];
    if (k === undefined || v === undefined) throw new PbfError('Feature tag index out of range');
    properties[k] = v;
  }
  const feature: TileFeature = { type, properties, geometry: decodeGeometry(commands, type) };
  if (id !== undefined) feature.id = id;
  return feature;
}

const zigzag = (v: number): number => (v % 2 === 0 ? v / 2 : -(v + 1) / 2);

function decodeGeometry(commands: readonly number[], type: GeometryType): TilePoint[][] {
  const out: TilePoint[][] = [];
  let x = 0;
  let y = 0;
  let current: TilePoint[] | null = null;
  let i = 0;
  while (i < commands.length) {
    const c = commands[i++] as number;
    const op = c & 7;
    const count = c >>> 3;
    if (op === 7) {
      // ClosePath: the ring is closed implicitly; nothing to add.
      current = null;
      continue;
    }
    if (op !== 1 && op !== 2) throw new PbfError(`Unknown geometry command ${op}`);
    if (i + count * 2 > commands.length) throw new PbfError('Truncated geometry');
    for (let k = 0; k < count; k++) {
      x += zigzag(commands[i++] as number);
      y += zigzag(commands[i++] as number);
      if (op === 1 && (type !== 'point' || !current)) {
        current = [];
        out.push(current);
      }
      if (!current) throw new PbfError('LineTo before MoveTo');
      current.push([x, y]);
    }
  }
  if (type === 'polygon') {
    // Some encoders repeat the first point before ClosePath; rings are open here.
    for (const ring of out) {
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (ring.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) ring.pop();
    }
  }
  return out;
}

/** Surveyor's area in tile units; positive for MVT exterior rings (clockwise on screen, y down). */
export function tileRingArea(ring: readonly TilePoint[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as TilePoint;
    const q = ring[(i + 1) % n] as TilePoint;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Splits a polygon feature's rings into polygons: a ring with positive area
 * starts a new polygon, negative rings are holes of the current one, zero-area
 * rings are dropped (MVT 2.1 section 4.3.4.4). Tiles written with the opposite
 * winding (some v1 encoders) are detected by the sign of the first ring.
 */
export function featurePolygons(feature: TileFeature): TilePolygon[] {
  if (feature.type !== 'polygon') return [];
  const polygons: TilePolygon[] = [];
  let sign = 0;
  for (const ring of feature.geometry) {
    if (ring.length < 3) continue;
    const area = tileRingArea(ring);
    if (area === 0) continue;
    if (sign === 0) sign = area > 0 ? 1 : -1;
    if (area * sign > 0) polygons.push({ outer: ring, holes: [] });
    else polygons[polygons.length - 1]?.holes.push(ring);
  }
  if (sign < 0) {
    for (const p of polygons) {
      p.outer = p.outer.slice().reverse();
      p.holes = p.holes.map((h) => h.slice().reverse());
    }
  }
  return polygons;
}
