/**
 * Footprint presets and the seeded random footprint. A preset replaces the geometry
 * (footprint, neighbours, roads) and optionally the type; other parameters are kept.
 */
import {
  type BuildingInput,
  type BuildingType,
  type Polygon,
  Rng,
  type Vec2,
  seedFrom,
} from '@osm-buildingen/core';
import type { NeighbourInput, RoadInput } from '@osm-buildingen/core';
import { patchInput } from './state';

export interface PresetGeometry {
  footprint: Polygon;
  neighbours?: NeighbourInput[];
  roads?: RoadInput[];
  type?: BuildingType;
}

export interface Preset {
  id: string;
  label: string;
  make(): PresetGeometry;
}

/** Axis-aligned rectangle, counter-clockwise, lower-left corner at (x, y). */
export function rect(w: number, d: number, x = 0, y = 0): Vec2[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ];
}

/** Moves a ring so the bounding box is centred on the origin. */
function centre(points: Vec2[]): Vec2[] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return points.map(([x, y]) => [x - cx, y - cy]);
}

/** A straight road along the south side at distance `y`. */
const southRoad = (y: number, halfLength = 30): RoadInput => ({
  line: [
    [-halfLength, y],
    [halfLength, y],
  ],
  width: 6,
  kind: 'road',
});

export const PRESETS: readonly Preset[] = [
  {
    id: 'rect',
    label: 'Rectangle',
    make: () => ({ footprint: { outer: rect(12, 9, -6, -4.5) }, roads: [southRoad(-12)] }),
  },
  {
    id: 'L',
    label: 'L',
    make: () => ({
      footprint: {
        outer: centre([
          [0, 0],
          [14, 0],
          [14, 7],
          [7, 7],
          [7, 13],
          [0, 13],
        ]),
      },
      roads: [southRoad(-14)],
    }),
  },
  {
    id: 'T',
    label: 'T',
    make: () => ({
      footprint: {
        outer: centre([
          [0, 8],
          [6, 8],
          [6, 0],
          [12, 0],
          [12, 8],
          [18, 8],
          [18, 15],
          [0, 15],
        ]),
      },
      roads: [southRoad(-14)],
    }),
  },
  {
    id: 'U',
    label: 'U',
    make: () => ({
      footprint: {
        outer: centre([
          [0, 0],
          [20, 0],
          [20, 16],
          [14, 16],
          [14, 6],
          [6, 6],
          [6, 16],
          [0, 16],
        ]),
      },
      roads: [southRoad(-16)],
    }),
  },
  {
    id: 'courtyard',
    label: 'Courtyard',
    make: () => ({
      footprint: { outer: rect(24, 20, -12, -10), holes: [rect(12, 8, -6, -4).reverse()] },
      roads: [southRoad(-16)],
      type: 'apartments',
    }),
  },
  {
    id: 'townhouse',
    label: 'Townhouse lot',
    make: () => ({
      footprint: { outer: rect(6.5, 12, -3.25, -6) },
      neighbours: [
        { footprint: { outer: rect(7, 12, -10.25, -6) }, height: 11 },
        { footprint: { outer: rect(8, 13, 3.25, -6.5) }, height: 13 },
      ],
      roads: [southRoad(-11)],
      type: 'townhouse',
    }),
  },
  {
    id: 'garage',
    label: 'Garage + house',
    make: () => ({
      footprint: { outer: rect(3.5, 6, 5, -3) },
      neighbours: [{ footprint: { outer: rect(10, 9, -5, -4.5) }, height: 8.5, sameGroup: true }],
      roads: [southRoad(-10)],
      type: 'garage',
    }),
  },
];

/**
 * Seeded rectilinear footprint: a rectangle with up to two notches cut from its corners,
 * which covers rectangles, Ls, Ts and Us. Same seed, same footprint.
 */
export function randomFootprint(seed: string): PresetGeometry {
  const rng = new Rng(seedFrom('studio-footprint', seed));
  const q = (v: number): number => Math.round(v * 2) / 2; // half-metre grid keeps JSON readable
  const w = q(rng.range(7, 22));
  const d = q(rng.range(6, 16));
  // Corners counter-clockwise: SW, SE, NE, NW. A notch replaces the corner by three points.
  const corners: Vec2[] = rect(w, d);
  const cuts = rng.int(3);
  const cutAt = new Set<number>();
  while (cutAt.size < cuts) cutAt.add(rng.int(4));
  const outer: Vec2[] = [];
  corners.forEach((c, i) => {
    if (!cutAt.has(i)) {
      outer.push(c);
      return;
    }
    const cw = q(rng.range(2, w * 0.4));
    const cd = q(rng.range(2, d * 0.4));
    const sx = i === 0 || i === 3 ? 1 : -1; // direction pointing into the rectangle
    const sy = i === 0 || i === 1 ? 1 : -1;
    const along: Vec2 = [c[0] + sx * cw, c[1]];
    const inner: Vec2 = [c[0] + sx * cw, c[1] + sy * cd];
    const up: Vec2 = [c[0], c[1] + sy * cd];
    // Counter-clockwise traversal arrives at even corners along y and at odd corners along x.
    outer.push(...(i % 2 === 0 ? [up, inner, along] : [along, inner, up]));
  });
  return { footprint: { outer: centre(outer) }, roads: [southRoad(-(d / 2 + 6))] };
}

export function applyGeometry(input: BuildingInput, g: PresetGeometry): BuildingInput {
  return patchInput(input, {
    footprint: g.footprint,
    neighbours: g.neighbours,
    roads: g.roads,
    type: g.type,
  });
}

export function defaultInput(): BuildingInput {
  const g = (PRESETS[0] as Preset).make();
  return applyGeometry(
    { footprint: g.footprint, style: { region: 'de', modernity: 0.4 }, seed: 'studio' },
    g,
  );
}

/** A short random seed for re-rolls; the studio itself may be random, only core must not. */
export function randomSeed(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return (bytes[0] as number).toString(36);
}
