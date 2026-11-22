/**
 * Viewer settings and app state. No three.js and no DOM imports: everything here
 * is plain data plus a tiny observable store, so it can be tested in Node.
 */
import type { Region } from '@osm-buildingen/core';

export type DetailMode = 'full' | 'massing' | 'auto';
export type ColourMode = 'none' | 'type' | 'group' | 'era' | 'special' | 'notes';
export type AreaMode = 'bbox' | 'centre';
export type ThemeMode = 'auto' | 'light' | 'dark';

export const COLOUR_MODES: readonly { id: ColourMode; label: string }[] = [
  { id: 'none', label: 'Generated colours' },
  { id: 'type', label: 'Building type' },
  { id: 'group', label: 'Plot group' },
  { id: 'era', label: 'Era' },
  { id: 'special', label: 'Special buildings' },
  { id: 'notes', label: 'Notes / fallbacks' },
];

export const DEFAULT_OVERPASS = 'https://overpass-api.de/api/interpreter';

export interface Settings {
  region: Region;
  modernity: number;
  /** Global seed mixed into every building seed; '' = none. */
  seed: string;
  detail: DetailMode;
  /** Auto detail: tiles within this distance (m) of the camera target are full detail. */
  autoRadius: number;
  /** Townhouse store probability; null = style pack default. */
  shopProbability: number | null;
  /** Tile edge in metres. */
  tileSize: number;
  colourBy: ColourMode;
  showPassages: boolean;
  showNeighbours: boolean;
  /** Generate with `debug: true` in the workers (per-building notes and timings). */
  debugGeneration: boolean;
  shadows: boolean;
  fog: boolean;
  theme: ThemeMode;
  areaMode: AreaMode;
  bboxText: string;
  centreText: string;
  radius: number;
  endpoint: string;
  studioUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  region: 'de',
  modernity: 0.3,
  seed: '',
  detail: 'full',
  autoRadius: 300,
  shopProbability: null,
  tileSize: 250,
  colourBy: 'none',
  showPassages: false,
  showNeighbours: true,
  debugGeneration: false,
  shadows: false,
  fog: false,
  theme: 'auto',
  areaMode: 'bbox',
  bboxText: '9.98813,48.39654,9.99593,48.40006',
  centreText: '48.3984, 9.9925',
  radius: 250,
  endpoint: DEFAULT_OVERPASS,
  studioUrl: 'http://localhost:5173/',
};

/** Settings that change the generated inputs or meshes (others are view-only). */
export const GENERATION_KEYS = ['region', 'modernity', 'seed', 'shopProbability', 'tileSize'] as const;

const STORAGE_KEY = 'osm-buildingen.viewer.settings';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

/** Validates untrusted stored settings field by field; unknown or broken fields get defaults. */
export function sanitizeSettings(value: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (typeof value !== 'object' || value === null) return { ...d };
  const v = value as Record<string, unknown>;
  return {
    region: pick(v.region, ['de', 'us'], d.region),
    modernity: num(v.modernity, d.modernity, 0, 1),
    seed: str(v.seed, d.seed),
    detail: pick(v.detail, ['full', 'massing', 'auto'], d.detail),
    autoRadius: num(v.autoRadius, d.autoRadius, 25, 10000),
    shopProbability: v.shopProbability === null ? null : num(v.shopProbability, 0, 0, 1),
    tileSize: num(v.tileSize, d.tileSize, 25, 5000),
    colourBy: pick(
      v.colourBy,
      COLOUR_MODES.map((m) => m.id),
      d.colourBy,
    ),
    showPassages: bool(v.showPassages, d.showPassages),
    showNeighbours: bool(v.showNeighbours, d.showNeighbours),
    debugGeneration: bool(v.debugGeneration, d.debugGeneration),
    shadows: bool(v.shadows, d.shadows),
    fog: bool(v.fog, d.fog),
    theme: pick(v.theme, ['auto', 'light', 'dark'], d.theme),
    areaMode: pick(v.areaMode, ['bbox', 'centre'], d.areaMode),
    bboxText: str(v.bboxText, d.bboxText),
    centreText: str(v.centreText, d.centreText),
    radius: num(v.radius, d.radius, 10, 5000),
    endpoint: str(v.endpoint, d.endpoint) || d.endpoint,
    studioUrl: str(v.studioUrl, d.studioUrl) || d.studioUrl,
  };
}

export function loadSettings(): Settings {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is a convenience only (private mode, quota).
  }
}

/** Whether the debug overlays or the user need per-building debug data from the workers. */
export const needsDebug = (s: Settings): boolean => s.debugGeneration || s.colourBy === 'notes';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  /** Calls `listener` with the new and the previous value after every `set`. */
  subscribe(listener: (value: T, previous: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T, previous: T) => void>();
  return {
    get: () => value,
    set(patch) {
      const previous = value;
      value = { ...value, ...patch };
      for (const l of listeners) l(value, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function changed<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): boolean {
  return keys.some((k) => a[k] !== b[k]);
}
