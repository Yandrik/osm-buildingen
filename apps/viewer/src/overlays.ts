/**
 * Debug overlays. Colour modes recolour the merged tile buffers in place (the
 * generated colours are kept per tile and restored); the shading of the generated
 * colour is kept so windows and roofs stay readable. Geometry overlays (passages,
 * selection outline, neighbour links) are a few lines in their own group.
 */
import type { BuildingInput, BuildingType, NeighbourInput, Polygon, Vec2 } from '@osm-buildingen/core';
import { hashString } from '@osm-buildingen/core';
import type { BuildingMeta } from '@osm-buildingen/osm';
import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { DebugSummary, ResolveCache } from './analysis';
import type { TileView } from './scene';
import type { ColourMode } from './state';
import { type Rgb, type Strip, ringSegments, stripGeometry } from './strips';

export interface OverlayContext {
  meta: readonly BuildingMeta[];
  inputs: readonly BuildingInput[];
  resolved: ResolveCache;
  /** Present for buildings generated with `debug: true`. */
  debug: readonly (DebugSummary | undefined)[];
  groupSizes: ReadonlyMap<string, number>;
}

export const TYPE_COLOURS: Record<BuildingType, Rgb> = {
  house: [230, 159, 0],
  apartments: [213, 94, 0],
  townhouse: [204, 121, 167],
  garage: [150, 150, 150],
  shed: [110, 110, 110],
  office: [0, 114, 178],
  skyscraper: [40, 40, 160],
  industrial: [120, 90, 60],
  station: [0, 158, 115],
  store: [240, 228, 66],
};

const GREY: Rgb = [185, 185, 185];
const DARK: Rgb = [90, 90, 90];
const SPECIAL: Rgb = [200, 40, 200];
const FALLBACK: Rgb = [220, 40, 40];
const NOTES: Rgb = [245, 150, 30];
const CLEAN: Rgb = [120, 190, 120];
export const HIGHLIGHT: Rgb = [255, 210, 0];

const ERA_STOPS: readonly [number, Rgb][] = [
  [0, [140, 60, 30]],
  [0.5, [225, 195, 90]],
  [1, [50, 130, 220]],
];

function eraColour(era: number): Rgb {
  for (let k = 1; k < ERA_STOPS.length; k++) {
    const [t1, c1] = ERA_STOPS[k] as [number, Rgb];
    const [t0, c0] = ERA_STOPS[k - 1] as [number, Rgb];
    if (era <= t1 || k === ERA_STOPS.length - 1) {
      const f = Math.min(1, Math.max(0, (era - t0) / (t1 - t0)));
      return [0, 1, 2].map((c) =>
        Math.round((c0[c] as number) + ((c1[c] as number) - (c0[c] as number)) * f),
      ) as [number, number, number];
    }
  }
  return GREY;
}

function groupColour(key: string): Rgb {
  // Golden-angle hue steps from the hash so neighbouring groups rarely look alike.
  const h = ((hashString(key) % 360) * 137.508) % 360;
  const s = 0.65;
  const l = 0.55;
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Colour for building `i` in `mode`; null keeps the generated colours. */
export function colourFor(mode: ColourMode, i: number, ctx: OverlayContext): Rgb | null {
  const meta = ctx.meta[i];
  if (mode === 'none' || !meta) return null;
  switch (mode) {
    case 'type': {
      if (meta.special) return SPECIAL;
      const spec = ctx.resolved.get(i);
      return spec ? TYPE_COLOURS[spec.type] : DARK;
    }
    case 'group':
      return (ctx.groupSizes.get(meta.groupKey) ?? 1) > 1 ? groupColour(meta.groupKey) : GREY;
    case 'era': {
      const spec = ctx.resolved.get(i);
      return spec ? eraColour(spec.era) : DARK;
    }
    case 'special':
      return meta.special ? SPECIAL : GREY;
    case 'notes': {
      const d = ctx.debug[i];
      if (!d) return DARK;
      if (d.facadeFallback) return FALLBACK;
      return d.notes.length > 0 ? NOTES : CLEAN;
    }
  }
}

export function needsResolve(mode: ColourMode): boolean {
  return mode === 'type' || mode === 'era';
}

export function legend(mode: ColourMode): { label: string; colour: Rgb }[] {
  switch (mode) {
    case 'type':
      return [
        ...Object.entries(TYPE_COLOURS).map(([label, colour]) => ({ label, colour })),
        { label: 'special (massing)', colour: SPECIAL },
      ];
    case 'group':
      return [
        { label: 'one colour per plot group', colour: groupColour('osm-example') },
        { label: 'alone in its group', colour: GREY },
      ];
    case 'era':
      return [
        { label: 'old (0)', colour: eraColour(0) },
        { label: '0.5', colour: eraColour(0.5) },
        { label: 'new (1)', colour: eraColour(1) },
      ];
    case 'special':
      return [
        { label: 'special', colour: SPECIAL },
        { label: 'normal', colour: GREY },
      ];
    case 'notes':
      return [
        { label: 'facade fallback', colour: FALLBACK },
        { label: 'notes', colour: NOTES },
        { label: 'clean', colour: CLEAN },
        { label: 'no debug data', colour: DARK },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Painting tile buffers
// ---------------------------------------------------------------------------

/** Rewrites the colours of one building (range `k` of the tile). */
export function paintBuilding(view: TileView, k: number, colour: Rgb | null, highlighted: boolean): void {
  const range = view.ranges[k];
  if (!range) return;
  const attribute = view.mesh.geometry.getAttribute('color') as BufferAttribute;
  const out = attribute.array as Uint8Array;
  const base = view.baseColours;
  const from = range.vertexStart * 3;
  const to = from + range.vertexCount * 3;
  if (!colour && !highlighted) {
    out.set(base.subarray(from, to), from);
  } else {
    for (let o = from; o < to; o += 3) {
      const r = base[o] as number;
      const g = base[o + 1] as number;
      const b = base[o + 2] as number;
      let cr = r;
      let cg = g;
      let cb = b;
      if (colour) {
        // Keep the light/dark pattern of the generated colours (windows, roof vs wall).
        const shade = 0.45 + (0.55 * (0.3 * r + 0.59 * g + 0.11 * b)) / 255;
        cr = colour[0] * shade;
        cg = colour[1] * shade;
        cb = colour[2] * shade;
      }
      if (highlighted) {
        cr = cr * 0.35 + HIGHLIGHT[0] * 0.65;
        cg = cg * 0.35 + HIGHLIGHT[1] * 0.65;
        cb = cb * 0.35 + HIGHLIGHT[2] * 0.65;
      }
      out[o] = cr;
      out[o + 1] = cg;
      out[o + 2] = cb;
    }
  }
  attribute.needsUpdate = true;
}

export function paintTile(
  view: TileView,
  colour: (globalIndex: number) => Rgb | null,
  selected: number | null,
): void {
  view.buildings.forEach((global, k) => {
    paintBuilding(view, k, colour(global), global === selected);
  });
}

// ---------------------------------------------------------------------------
// Geometry overlays
// ---------------------------------------------------------------------------

export interface SelectionGeometry {
  footprint: Polygon;
  /** Roof top height of the building, from its mesh. */
  top: number;
  neighbours: readonly NeighbourInput[];
}

export interface OverlayLayers {
  setPassages(lines: readonly { line: readonly Vec2[]; width: number }[] | null): void;
  setSelection(selection: SelectionGeometry | null, showNeighbours: boolean): void;
}

const centroidOf = (ring: readonly Vec2[]): Vec2 => {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / Math.max(1, ring.length), y / Math.max(1, ring.length)];
};

export function createOverlayLayers(group: Group): OverlayLayers {
  const lineMaterial = (colour: number): LineBasicMaterial =>
    new LineBasicMaterial({ color: colour, depthTest: false, transparent: true });
  const outlineMat = lineMaterial(0xffd200);
  const sameGroupMat = lineMaterial(0x1e9e57);
  const otherMat = lineMaterial(0xff5a1f);
  const passageMat = new MeshBasicMaterial({
    color: 0xff00aa,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -8,
  });

  let passages: Mesh | null = null;
  let selection: LineSegments[] = [];

  const lines = (positions: Float32Array, material: LineBasicMaterial): LineSegments => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    const l = new LineSegments(g, material);
    l.renderOrder = 10;
    return l;
  };

  return {
    setPassages(list) {
      if (passages) {
        group.remove(passages);
        passages.geometry.dispose();
        passages = null;
      }
      if (!list || list.length === 0) return;
      const strips: Strip[] = list.map((p) => ({
        line: p.line,
        width: Math.max(1.5, p.width),
        colour: [255, 0, 170],
        y: 0.12,
      }));
      passages = new Mesh(stripGeometry(strips), passageMat);
      passages.renderOrder = 5;
      group.add(passages);
    },
    setSelection(sel, showNeighbours) {
      for (const l of selection) {
        group.remove(l);
        l.geometry.dispose();
      }
      selection = [];
      if (!sel) return;
      const rings = [sel.footprint.outer, ...(sel.footprint.holes ?? [])];
      selection.push(lines(ringSegments(rings, 0.15), outlineMat));
      selection.push(lines(ringSegments(rings, sel.top + 0.15), outlineMat));
      if (showNeighbours && sel.neighbours.length > 0) {
        const [cx, cy] = centroidOf(sel.footprint.outer);
        const linkY = Math.min(sel.top, 6);
        for (const same of [true, false]) {
          const list = sel.neighbours.filter((n) => (n.sameGroup ?? false) === same);
          if (list.length === 0) continue;
          const outlines = ringSegments(
            list.map((n) => n.footprint.outer),
            0.2,
          );
          const links: number[] = [];
          for (const n of list) {
            const [nx, ny] = centroidOf(n.footprint.outer);
            links.push(cx, linkY, -cy, nx, linkY, -ny);
          }
          const merged = new Float32Array(outlines.length + links.length);
          merged.set(outlines);
          merged.set(links, outlines.length);
          selection.push(lines(merged, same ? sameGroupMat : otherMat));
        }
      }
      for (const l of selection) group.add(l);
    },
  };
}
