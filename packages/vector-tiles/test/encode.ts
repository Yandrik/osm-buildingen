/*
 * Minimal MVT encoder for tests: builds tiny tiles in memory so no binary
 * fixture is needed for the synthetic cases.
 */

export type Value = string | number | boolean;

export interface EncodeFeature {
  id?: number;
  type: 'point' | 'line' | 'polygon';
  properties?: Record<string, Value>;
  /** Points: one array. Lines: one per line. Polygons: rings in MVT order, open, exterior with positive area (y down). */
  geometry: [number, number][][];
}

export interface EncodeLayer {
  name: string;
  extent?: number;
  features: EncodeFeature[];
}

class Writer {
  bytes: number[] = [];
  varint(v: number): void {
    let n = v;
    while (n >= 0x80) {
      this.bytes.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.bytes.push(n);
  }
  key(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }
  message(field: number, body: Writer): void {
    this.key(field, 2);
    this.varint(body.bytes.length);
    this.bytes.push(...body.bytes);
  }
  string(field: number, s: string): void {
    const b = new TextEncoder().encode(s);
    this.key(field, 2);
    this.varint(b.length);
    this.bytes.push(...b);
  }
  packed(field: number, values: number[]): void {
    const w = new Writer();
    for (const v of values) w.varint(v);
    this.message(field, w);
  }
  double(field: number, v: number): void {
    this.key(field, 1);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.bytes.push(...b);
  }
}

const zz = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1);
const command = (id: number, count: number): number => (count << 3) | id;

function geometry(f: EncodeFeature): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  const move = (p: [number, number]): void => {
    out.push(zz(p[0] - x), zz(p[1] - y));
    x = p[0];
    y = p[1];
  };
  if (f.type === 'point') {
    const pts = f.geometry[0] ?? [];
    out.push(command(1, pts.length));
    for (const p of pts) move(p);
    return out;
  }
  for (const part of f.geometry) {
    out.push(command(1, 1));
    move(part[0] as [number, number]);
    out.push(command(2, part.length - 1));
    for (const p of part.slice(1)) move(p);
    if (f.type === 'polygon') out.push(command(7, 1));
  }
  return out;
}

/** Encodes layers into an uncompressed MVT buffer. */
export function encodeTile(layers: EncodeLayer[]): Uint8Array {
  const tile = new Writer();
  for (const layer of layers) {
    const l = new Writer();
    l.varint(15 * 8);
    l.varint(2);
    l.string(1, layer.name);
    const keys: string[] = [];
    const values: Value[] = [];
    const index = <T>(list: T[], v: T): number => {
      const i = list.indexOf(v);
      if (i >= 0) return i;
      list.push(v);
      return list.length - 1;
    };
    for (const f of layer.features) {
      const fw = new Writer();
      if (f.id !== undefined) {
        fw.key(1, 0);
        fw.varint(f.id);
      }
      const tags: number[] = [];
      for (const [k, v] of Object.entries(f.properties ?? {})) tags.push(index(keys, k), index(values, v));
      if (tags.length) fw.packed(2, tags);
      fw.key(3, 0);
      fw.varint(f.type === 'point' ? 1 : f.type === 'line' ? 2 : 3);
      fw.packed(4, geometry(f));
      l.message(2, fw);
    }
    for (const k of keys) l.string(3, k);
    for (const v of values) {
      const vw = new Writer();
      if (typeof v === 'string') vw.string(1, v);
      else if (typeof v === 'boolean') {
        vw.key(7, 0);
        vw.varint(v ? 1 : 0);
      } else if (Number.isInteger(v) && v >= 0) {
        vw.key(5, 0);
        vw.varint(v);
      } else if (Number.isInteger(v)) {
        vw.key(6, 0);
        vw.varint(zz(v));
      } else vw.double(3, v);
      l.message(4, vw);
    }
    l.key(5, 0);
    l.varint(layer.extent ?? 4096);
    tile.message(3, l);
  }
  return new Uint8Array(tile.bytes);
}

/** Axis-aligned rectangle as an MVT exterior ring (positive area with y down: clockwise on screen). */
export function rect(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}
