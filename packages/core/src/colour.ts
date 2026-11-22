/** Colour packed as 0xRRGGBB. */
export type Colour = number;

const NAMED: Record<string, Colour> = {
  white: 0xf4f4f0,
  black: 0x2b2b2b,
  grey: 0x8a8a8a,
  gray: 0x8a8a8a,
  red: 0xb8352b,
  brown: 0x7a4a2a,
  green: 0x4d8a52,
  blue: 0x3c5aa6,
  yellow: 0xe0c341,
  orange: 0xd9822b,
  beige: 0xe3d6b8,
  silver: 0xc0c0c0,
  maroon: 0x7a2a2a,
  darkgrey: 0x555555,
  darkgray: 0x555555,
  lightgrey: 0xc8c8c8,
  lightgray: 0xc8c8c8,
  pink: 0xe8b0b8,
  purple: 0x7d5a9a,
  cream: 0xf1e8d0,
  tan: 0xd2b48c,
};

/** Parses '#rgb', '#rrggbb' or a small set of colour names. Returns null if unknown. */
export function parseColour(text: string | undefined | null): Colour | null {
  if (!text) return null;
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  let m = /^#?([0-9a-f]{6})$/.exec(t);
  if (m) return Number.parseInt(m[1] as string, 16);
  m = /^#?([0-9a-f]{3})$/.exec(t);
  if (m) {
    const h = m[1] as string;
    return Number.parseInt(`${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`, 16);
  }
  return NAMED[t] ?? null;
}

export const red = (c: Colour): number => (c >> 16) & 0xff;
export const green = (c: Colour): number => (c >> 8) & 0xff;
export const blue = (c: Colour): number => c & 0xff;

export function rgb(r: number, g: number, b: number): Colour {
  const q = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

/** Multiplies brightness. factor < 1 darkens, > 1 lightens. */
export function shade(c: Colour, factor: number): Colour {
  return rgb(red(c) * factor, green(c) * factor, blue(c) * factor);
}

/** Linear blend from a to b. */
export function mixColour(a: Colour, b: Colour, t: number): Colour {
  return rgb(
    red(a) + (red(b) - red(a)) * t,
    green(a) + (green(b) - green(a)) * t,
    blue(a) + (blue(b) - blue(a)) * t,
  );
}
