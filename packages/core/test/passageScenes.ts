/** Buildings with roads through them, for passages.test.ts and tools/passages.ts. */
import type { BuildingInput, RoadInput, Vec2 } from '../src';
import { rect } from './shapes';

export interface PassageScene {
  name: string;
  input: BuildingInput;
  /** Expected number of passages, counted over all parts. */
  passages: number;
  /** Horizontal lines (footprint coordinates) along the middle of a corridor: free up to the ceiling. */
  clear: [Vec2, Vec2][];
  /** Lines along the side of a corridor: free up to where the arch springs. */
  edge?: [Vec2, Vec2][];
  /** Horizontal lines that must hit the building at 1 m: no opening there. */
  solid: [Vec2, Vec2][];
}

const road = (line: Vec2[], over: Partial<RoadInput> = {}): RoadInput => ({
  line,
  width: 4,
  passage: true,
  ...over,
});
const building = (outer: Vec2[], roads: RoadInput[], over: Partial<BuildingInput> = {}): BuildingInput => ({
  footprint: { outer },
  type: 'apartments',
  levels: 3,
  roof: { shape: 'flat' },
  style: { region: 'de', modernity: 0.4 },
  seed: 'passage',
  roads,
  debug: true,
  ...over,
});
/** A north-south road at x, crossing a building that lies between y = 0 and y = depth. */
const northSouth = (x: number, over: Partial<RoadInput> = {}): RoadInput =>
  road(
    [
      [x, -30],
      [x, 50],
    ],
    over,
  );
const across = (x: number, depth: number): [Vec2, Vec2] => [
  [x, -6],
  [x, depth + 6],
];

const twoParts = [
  { footprint: { outer: rect(18, 10) }, levels: 6, roof: { shape: 'flat' as const } },
  { footprint: { outer: rect(12, 10, 18, 0) }, levels: 3, roof: { shape: 'flat' as const } },
];
const circle: Vec2[] = Array.from(
  { length: 40 },
  (_, i): Vec2 => [12 * Math.cos((i / 40) * 2 * Math.PI), 12 * Math.sin((i / 40) * 2 * Math.PI)],
);

export const PASSAGE_SCENES: PassageScene[] = [
  {
    // Corridor 5 m wide (road 4 m + 1 m), centred on x = 15.
    name: 'straight',
    input: building(rect(30, 10), [northSouth(15)]),
    passages: 1,
    clear: [across(15, 10)],
    edge: [across(12.8, 10), across(17.2, 10)],
    solid: [across(8, 10), across(22, 10), across(12.2, 10), across(17.8, 10)],
  },
  {
    name: 'oblique',
    input: building(rect(34, 11), [
      road([
        [4, -12],
        [30, 23],
      ]),
    ]),
    passages: 1,
    clear: [
      [
        [8.46, -6],
        [25.54, 17],
      ],
    ],
    solid: [across(5, 11), across(29, 11)],
  },
  {
    // Not flagged: the block is large enough for the road line alone to count.
    name: 'bend',
    input: building(rect(30, 30), [
      road(
        [
          [8, -20],
          [8, 15],
          [50, 15],
        ],
        { passage: false },
      ),
    ]),
    passages: 1,
    clear: [
      [
        [8, -6],
        [8, 15],
      ],
      [
        [8, 15],
        [36, 15],
      ],
    ],
    solid: [
      [
        [8, 15],
        [8, 36],
      ],
      [
        [-6, 15],
        [8, 15],
      ],
    ],
  },
  {
    name: 'sharp-bend',
    input: building(rect(30, 30), [
      road([
        [6, -20],
        [20, 20],
        [26, -20],
      ]),
    ]),
    passages: 1,
    clear: [
      [
        [10.9, -6],
        [20, 20],
      ],
      [
        [20, 20],
        [23.9, -6],
      ],
    ],
    solid: [across(20, 30)],
  },
  {
    // The road ends in the courtyard: outer wall and courtyard wall both open.
    name: 'courtyard',
    input: building(
      rect(30, 30),
      [
        road([
          [15, -20],
          [15, 15],
        ]),
      ],
      {
        footprint: {
          outer: rect(30, 30),
          holes: [
            [
              [10, 10],
              [10, 20],
              [20, 20],
              [20, 10],
            ],
          ],
        },
      },
    ),
    passages: 1,
    clear: [
      [
        [15, -6],
        [15, 15],
      ],
    ],
    solid: [
      [
        [15, 15],
        [15, 36],
      ],
    ],
  },
  {
    // The corridor contains the corner itself: one notch, not a way through.
    name: 'corner',
    input: building(rect(30, 12), [
      road([
        [-8, 10],
        [10, -8],
      ]),
    ]),
    passages: 0,
    clear: [],
    solid: [
      [
        [-4, 6],
        [6, -4],
      ],
    ],
  },
  {
    name: 'dead-end',
    input: building(rect(30, 10), [
      road([
        [15, -30],
        [15, 5],
      ]),
    ]),
    passages: 0,
    clear: [],
    solid: [across(15, 10)],
  },
  {
    name: 'small-unflagged',
    input: building(rect(10, 8), [northSouth(5, { passage: false })]),
    passages: 0,
    clear: [],
    solid: [across(5, 8)],
  },
  {
    name: 'small-flagged',
    input: building(rect(10, 8), [northSouth(5, { width: 2, kind: 'path' })]),
    passages: 1,
    clear: [across(5, 8)],
    solid: [across(2.5, 8), across(7.5, 8)],
  },
  {
    name: 'parallel',
    input: building(rect(40, 10), [northSouth(10), northSouth(28)]),
    passages: 2,
    clear: [across(10, 10), across(28, 10)],
    solid: [across(19, 10), across(4, 10), across(35, 10)],
  },
  {
    // Corridors 15.5..20.5 and 18.5..23.5 overlap and become one tunnel.
    name: 'overlap',
    input: building(rect(40, 12), [northSouth(18), northSouth(21)]),
    passages: 1,
    clear: [across(19.5, 12), across(18, 12), across(21, 12)],
    edge: [across(15.8, 12), across(23.2, 12)],
    solid: [across(15, 12), across(24, 12)],
  },
  {
    name: 'crossing',
    input: building(rect(30, 30), [
      northSouth(15),
      road([
        [-30, 15],
        [60, 15],
      ]),
    ]),
    passages: 1,
    clear: [
      across(15, 30),
      [
        [-6, 15],
        [36, 15],
      ],
    ],
    solid: [across(7, 30), across(23, 30)],
  },
  {
    // Through both parts: the wall between them must be open as well.
    name: 'parts-across',
    input: building(
      rect(30, 10),
      [
        road([
          [-30, 5],
          [60, 5],
        ]),
      ],
      { type: 'office', parts: twoParts },
    ),
    passages: 2,
    clear: [
      [
        [-6, 5],
        [36, 5],
      ],
    ],
    edge: [
      [
        [-6, 2.8],
        [36, 2.8],
      ],
      [
        [-6, 7.2],
        [36, 7.2],
      ],
    ],
    solid: [across(9, 10), across(24, 10)],
  },
  {
    // One road along the joint between the parts, one through the tall part.
    name: 'parts-joint',
    input: building(rect(30, 10), [northSouth(18), northSouth(7)], { type: 'office', parts: twoParts }),
    passages: 3,
    clear: [across(18, 10), across(7, 10)],
    edge: [across(15.8, 10), across(20.2, 10), across(4.8, 10), across(9.2, 10)],
    solid: [across(12.5, 10), across(26, 10), across(2, 10)],
  },
  {
    // A part bridging a gap that is already there: nothing to cut, and the bridge stays whole.
    name: 'parts-bridge',
    input: building(rect(30, 10), [northSouth(15)], {
      type: 'office',
      parts: [
        { footprint: { outer: rect(12, 10) }, levels: 4, roof: { shape: 'flat' } },
        { footprint: { outer: rect(12, 10, 18, 0) }, levels: 4, roof: { shape: 'flat' } },
        { footprint: { outer: rect(6, 10, 12, 0) }, levels: 4, minLevel: 1, roof: { shape: 'flat' } },
      ],
    }),
    passages: 0,
    clear: [across(15, 10)],
    solid: [across(6, 10), across(24, 10)],
  },
  {
    // The next house in the row stands against the east wall and has the same road through it.
    name: 'row',
    input: building(
      rect(15, 10),
      [
        road([
          [-30, 5],
          [60, 5],
        ]),
      ],
      { neighbours: [{ footprint: { outer: rect(15, 10, 15, 0) }, height: 12 }] },
    ),
    passages: 1,
    clear: [
      [
        [-6, 5],
        [21, 5],
      ],
    ],
    solid: [across(7, 10)],
  },
  {
    // Short walls: every opening runs over several of them.
    name: 'round',
    input: building(circle, [
      road([
        [-30, 2],
        [30, 2],
      ]),
    ]),
    passages: 1,
    clear: [
      [
        [-18, 2],
        [18, 2],
      ],
    ],
    solid: [
      [
        [-18, -7],
        [18, -7],
      ],
    ],
  },
  {
    name: 'massing',
    input: building(rect(30, 10), [northSouth(15)], { detail: 'massing' }),
    passages: 1,
    clear: [across(15, 10)],
    edge: [across(12.8, 10), across(17.2, 10)],
    solid: [across(8, 10), across(22, 10), across(12.2, 10), across(17.8, 10)],
  },
  {
    name: 'massing-parts',
    input: building(
      rect(30, 10),
      [
        road([
          [-30, 5],
          [60, 5],
        ]),
      ],
      { type: 'office', parts: twoParts, detail: 'massing' },
    ),
    passages: 2,
    clear: [
      [
        [-6, 5],
        [36, 5],
      ],
    ],
    solid: [across(9, 10), across(24, 10)],
  },
];
