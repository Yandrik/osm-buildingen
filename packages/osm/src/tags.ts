import type { RoofShape } from '@osm-buildingen/core';
import type { Tags } from './types';

/*
 * Parsers for OSM tag values. Every parser returns undefined for values it does
 * not understand; garbage in OSM is common and must never reach core as NaN.
 */

/** Tag object without a prototype, so `__proto__` or `constructor` keys are plain data. */
export const emptyTags = (): Tags => Object.create(null) as Tags;

const FOOT = 0.3048;
const INCH = 0.0254;
const UNIT: Record<string, number> = {
  '': 1,
  m: 1,
  meter: 1,
  meters: 1,
  metre: 1,
  metres: 1,
  cm: 0.01,
  km: 1000,
  ft: FOOT,
  feet: FOOT,
  foot: FOOT,
  "'": FOOT,
  in: INCH,
  '"': INCH,
  mi: 1609.344,
};

/** Upper bound for any length we accept; taller values are typos. */
const MAX_LENGTH = 1000;

/** `"12,5"` is a decimal comma (common in German data), `"1,234"` is not unambiguous: treat as decimal too. */
function decimal(text: string): number {
  return Number(text.replace(',', '.'));
}

/**
 * Parses a length to metres: `12`, `12 m`, `12.5m`, `12,5`, `40 ft`, `12'`, `12'6"`.
 * Returns undefined for garbage, negative values and values above 1000 m.
 */
export function parseLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const t = value.trim().toLowerCase();
  // Feet and inches: 12'6" or 12' 6"
  let m = /^(\d+(?:[.,]\d+)?)\s*'\s*(\d+(?:[.,]\d+)?)\s*(?:"|'')$/.exec(t);
  if (m) return check(decimal(m[1] as string) * FOOT + decimal(m[2] as string) * INCH);
  m = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*([a-z'"]*)\.?$/.exec(t);
  if (!m) return undefined;
  const unit = UNIT[m[2] as string];
  if (unit === undefined) return undefined;
  return check(decimal(m[1] as string) * unit);
}

function check(v: number): number | undefined {
  return Number.isFinite(v) && v >= 0 && v <= MAX_LENGTH ? v : undefined;
}

/**
 * Parses a level count (`building:levels`, `roof:levels`, `building:min_level`).
 * Fractions are rounded to the nearest integer (`2.5` -> 3); `3;4` takes the first value.
 */
export function parseLevels(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:;.*)?$/.exec(value);
  if (!m) return undefined;
  const v = Math.round(decimal(m[1] as string));
  return Number.isFinite(v) && v >= 0 && v <= 200 ? v : undefined;
}

const COMPASS = [
  'n',
  'nne',
  'ne',
  'ene',
  'e',
  'ese',
  'se',
  'sse',
  's',
  'ssw',
  'sw',
  'wsw',
  'w',
  'wnw',
  'nw',
  'nnw',
] as const;

/** Parses `roof:direction`: degrees (`45`, `45°`, `-90`) or compass letters (`N`, `SSW`). Result in [0, 360). */
export function parseDirection(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const t = value.trim().toLowerCase();
  const index = (COMPASS as readonly string[]).indexOf(t);
  if (index >= 0) return index * 22.5;
  const m = /^(-?\d+(?:[.,]\d+)?)\s*(?:°|deg)?$/.exec(t);
  if (!m) return undefined;
  const v = decimal(m[1] as string);
  if (!Number.isFinite(v)) return undefined;
  return ((v % 360) + 360) % 360;
}

/** `roof:orientation`: `along` / `across` the long side. */
export function parseRidge(value: string | undefined): 'along' | 'across' | undefined {
  const t = value?.trim().toLowerCase();
  return t === 'along' || t === 'across' ? t : undefined;
}

/**
 * OSM `roof:shape` values to core shapes. Values core cannot build (dome, onion,
 * round, cone, many, …) are left out, so core picks a shape itself.
 */
export const ROOF_SHAPE_TABLE: Readonly<Record<string, RoofShape>> = {
  flat: 'flat',
  gabled: 'gabled',
  pitched: 'gabled',
  saltbox: 'gabled',
  crosspitched: 'gabled',
  cross_gabled: 'gabled',
  hipped: 'hipped',
  side_hipped: 'hipped',
  'half-hipped': 'half-hipped',
  half_hipped: 'half-hipped',
  halfhipped: 'half-hipped',
  pyramidal: 'pyramidal',
  pyramid: 'pyramidal',
  skillion: 'skillion',
  lean_to: 'skillion',
  monopitch: 'skillion',
  gambrel: 'gambrel',
  mansard: 'mansard',
};

export function parseRoofShape(value: string | undefined): RoofShape | undefined {
  if (value === undefined) return undefined;
  return ROOF_SHAPE_TABLE[value.trim().toLowerCase()];
}

const MIN_YEAR = 100;
const MAX_YEAR = 2100;

/**
 * Parses `start_date` to a year: `1993`, `1993-05-01`, `~1890`, `1890s`, `C19`,
 * `early C19`, `mid 19th century`, `1890..1900`, `1890-1900`, `before 1900`.
 * Ranges give the midpoint, centuries the middle (or early/late third).
 */
export function parseYear(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const t = value
    .trim()
    .toLowerCase()
    .replace(/^(?:~|ca\.?|circa|about|approx\.?)\s*/, '');

  // Century: C19, 19th century, early C19, late 19th century
  let m = /^(early|mid|late)?\s*(?:c\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)\s*(?:century|cent\.?|c))$/.exec(t);
  if (m) {
    const century = Number(m[2] ?? m[3]);
    const start = (century - 1) * 100;
    const offset = m[1] === 'early' ? 15 : m[1] === 'late' ? 85 : 50;
    return year(start + offset);
  }
  // Decade: 1890s
  m = /^(\d{3})0s$/.exec(t);
  if (m) return year(Number(m[1]) * 10 + 5);
  // Range: 1890..1900, 1890-1900, 1890/1900 (but not 1993-05-01)
  m = /^(\d{3,4})\s*(?:\.\.|–|\/|-)\s*(\d{3,4})$/.exec(t);
  if (m) return year(Math.round((Number(m[1]) + Number(m[2])) / 2));
  // before / after
  m = /^(before|after)\s+(\d{3,4})$/.exec(t);
  if (m) return year(Number(m[2]) + (m[1] === 'before' ? -10 : 10));
  // Date or plain year, optionally with trailing EDTF qualifiers (1900~, 1900?)
  m = /^(\d{3,4})(?:-\d{2}(?:-\d{2})?)?[~?]?$/.exec(t);
  if (m) return year(Number(m[1]));
  return undefined;
}

function year(v: number): number | undefined {
  return Number.isInteger(v) && v >= MIN_YEAR && v <= MAX_YEAR ? v : undefined;
}

/** Trimmed, non-empty tag value. */
export function tagValue(tags: Tags, key: string): string | undefined {
  const v = tags[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}
