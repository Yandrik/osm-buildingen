/**
 * Getting inputs in and out of the studio: permalink, localStorage, clipboard,
 * test-case snippet and file downloads.
 *
 * Permalink format (also used by the viewer's "open in studio"):
 *   #z=<base64url(deflate-raw(JSON))>   when CompressionStream is available
 *   #j=<base64url(JSON)>                fallback, also accepted on load
 */
import { type BuildingInput, GENERATOR_VERSION } from '@osm-buildingen/core';
import { exportableInput, parseInput } from './state';

const STORAGE_KEY = 'osm-buildingen.studio.input';

// ---------------------------------------------------------------------------
// base64url + deflate
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: GenericTransformStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const hasCompression = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Pretty JSON with each [x, y] point kept on one line. */
export function inputToJson(input: BuildingInput, indent = 2): string {
  const json = JSON.stringify(exportableInput(input), null, indent);
  return indent ? json.replace(/\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]/g, '[$1, $2]') : json;
}

export async function encodePermalinkHash(input: BuildingInput): Promise<string> {
  const json = new TextEncoder().encode(inputToJson(input, 0));
  if (hasCompression()) return `#z=${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `#j=${toBase64Url(json)}`;
}

/** Returns null when the hash holds no input; throws with a readable message when it is broken. */
export async function decodePermalinkHash(hash: string): Promise<BuildingInput | null> {
  const match = /^#([zj])=(.+)$/.exec(hash);
  if (!match) return null;
  const [, kind, payload] = match as unknown as [string, 'z' | 'j', string];
  let bytes = fromBase64Url(payload);
  if (kind === 'z') {
    if (!hasCompression()) throw new Error('This browser cannot decompress the permalink.');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  }
  return parseJsonInput(new TextDecoder().decode(bytes));
}

/** Parses and validates JSON text; throws an Error with a user-facing message. */
export function parseJsonInput(text: string): BuildingInput {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  const result = parseInput(value);
  if ('error' in result) throw new Error(result.error);
  return result.input;
}

// ---------------------------------------------------------------------------
// localStorage (may be unavailable or full: never let it break the app)
// ---------------------------------------------------------------------------

export function loadStoredInput(): BuildingInput | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parseJsonInput(text) : null;
  } catch {
    return null;
  }
}

export function storeInput(input: BuildingInput): void {
  try {
    localStorage.setItem(STORAGE_KEY, inputToJson(input, 0));
  } catch {
    // Storage is a convenience only.
  }
}

// ---------------------------------------------------------------------------
// Clipboard and downloads
// ---------------------------------------------------------------------------

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Plain-http dev servers on other hosts have no Clipboard API.
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Clipboard not available.');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A snippet for the golden tests: the exact input plus the generator version it was made with. */
export function testCaseSnippet(input: BuildingInput): string {
  return [
    `// From osm-buildingen studio, GENERATOR_VERSION ${GENERATOR_VERSION}`,
    `const mesh = generateBuilding(${inputToJson(input)});`,
    '',
  ].join('\n');
}

export function filenameFor(input: BuildingInput, ext: string): string {
  const seed =
    String(input.seed)
      .replace(/[^\w-]+/g, '_')
      .slice(0, 40) || 'building';
  return `building-${seed}.${ext}`;
}
