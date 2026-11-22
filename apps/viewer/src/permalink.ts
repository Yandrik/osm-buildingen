/**
 * "Open in studio" links. Same format the studio reads (apps/studio/src/share.ts):
 *   #z=<base64url(deflate-raw(JSON))>   when CompressionStream is available
 *   #j=<base64url(JSON)>                fallback
 * Copied rather than imported: the studio's share.ts pulls in its state module.
 * Candidate for a small shared package together with dom.ts.
 */
import type { BuildingInput, Vec2 } from '@osm-buildingen/core';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw') as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The input as the studio exports it: no `debug` flag. */
export function exportableInput(input: BuildingInput): BuildingInput {
  const { debug: _debug, ...rest } = input;
  return rest;
}

/** Pretty JSON with each [x, y] point kept on one line (same as the studio). */
export function inputToJson(input: BuildingInput, indent = 2): string {
  const json = JSON.stringify(exportableInput(input), null, indent);
  return indent ? json.replace(/\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]/g, '[$1, $2]') : json;
}

export async function encodePermalinkHash(input: BuildingInput): Promise<string> {
  const json = new TextEncoder().encode(inputToJson(input, 0));
  if (typeof CompressionStream !== 'undefined') return `#z=${toBase64Url(await deflate(json))}`;
  return `#j=${toBase64Url(json)}`;
}

/**
 * Moves an input (footprint, parts, neighbours, roads) by `-offset` so the building
 * sits near the studio's origin. Seeds are explicit in the input, so only float
 * rounding of the coordinates differs from the viewer's frame.
 */
export function recentre(input: BuildingInput, offset: Vec2): BuildingInput {
  const [ox, oy] = offset;
  const p = ([x, y]: Vec2): Vec2 => [round(x - ox), round(y - oy)];
  const ring = (r: readonly Vec2[]): Vec2[] => r.map(p);
  const poly = (f: BuildingInput['footprint']): BuildingInput['footprint'] =>
    f.holes ? { outer: ring(f.outer), holes: f.holes.map(ring) } : { outer: ring(f.outer) };
  const out: BuildingInput = { ...input, footprint: poly(input.footprint) };
  if (input.parts) out.parts = input.parts.map((part) => ({ ...part, footprint: poly(part.footprint) }));
  if (input.neighbours)
    out.neighbours = input.neighbours.map((n) => ({ ...n, footprint: poly(n.footprint) }));
  if (input.roads) out.roads = input.roads.map((r) => ({ ...r, line: ring(r.line) }));
  return out;
}

/** Millimetres are plenty and keep the link short. */
const round = (v: number): number => Math.round(v * 1000) / 1000;

export async function studioLink(studioUrl: string, input: BuildingInput, offset: Vec2): Promise<string> {
  const base = studioUrl.replace(/#.*$/, '');
  return base + (await encodePermalinkHash(recentre(input, offset)));
}
