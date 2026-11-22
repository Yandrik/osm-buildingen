/*
 * Minimal protobuf wire-format reader: just enough for the Mapbox Vector Tile
 * schema (varints, zig-zag, 32/64-bit floats, length-delimited fields).
 * Written here rather than depending on `pbf`, see plan/adapters/vector-tiles.md.
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

/** Thrown for truncated or malformed protobuf data. */
export class PbfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PbfError';
  }
}

const utf8 = new TextDecoder('utf-8');

export class PbfReader {
  pos: number;
  private readonly view: DataView;

  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  /** Unsigned varint as a number. Exact up to 2^53; larger values lose low bits (ids only). */
  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new PbfError('Truncated varint');
      const b = this.buf[this.pos++] as number;
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
    throw new PbfError('Varint longer than 10 bytes');
  }

  /** Varint interpreted as a two's complement int64 (negative values are 10 bytes on the wire). */
  int64(): number {
    const v = this.varint();
    return v >= 2 ** 63 ? v - 2 ** 64 : v;
  }

  /** Zig-zag encoded varint (sint32 / sint64). */
  svarint(): number {
    const v = this.varint();
    // Arithmetic instead of bit operators: values may exceed 32 bits.
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }

  float(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  double(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  /** Reads a length prefix and returns [start, end) of the payload, advancing past it. */
  bytes(): [number, number] {
    const len = this.varint();
    const start = this.pos;
    this.need(len);
    this.pos += len;
    return [start, start + len];
  }

  string(): string {
    const [start, end] = this.bytes();
    return utf8.decode(this.buf.subarray(start, end));
  }

  /** Reads a field key; returns [field number, wire type]. */
  key(): [number, number] {
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }

  skip(wire: number): void {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_FIXED64) this.advance(8);
    else if (wire === WIRE_BYTES) this.bytes();
    else if (wire === WIRE_FIXED32) this.advance(4);
    else throw new PbfError(`Unsupported wire type ${wire}`);
  }

  /** Packed repeated uint32 field. */
  packedVarints(): number[] {
    const [start, end] = this.bytes();
    const out: number[] = [];
    const r = new PbfReader(this.buf, start, end);
    while (r.pos < end) out.push(r.varint());
    return out;
  }

  more(): boolean {
    return this.pos < this.end;
  }

  private advance(n: number): void {
    this.need(n);
    this.pos += n;
  }

  private need(n: number): void {
    if (this.pos + n > this.end) throw new PbfError('Truncated message');
  }
}
