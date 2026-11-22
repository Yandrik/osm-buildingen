/**
 * 2D picker map for the OSM dialog (canvas, north up, metres in the adapter's frame):
 * every building footprint coloured by the adapter's type, special buildings hatched,
 * roads as lines. Hover shows a tooltip, click selects, drag pans, wheel zooms.
 */
import type { Polygon, Vec2 } from '@osm-buildingen/core';
import { cssVar, h } from './dom';
import { type BuildResult, type BuildingMeta, addressOf, buildingLabel } from './osm-import';

/** Fill colours per adapter type; readable on the light and the dark map background. */
export const TYPE_COLOURS: Record<string, string> = {
  house: '#e2a03f',
  townhouse: '#d9773a',
  apartments: '#c9564c',
  store: '#b24fa8',
  office: '#4f7fd1',
  skyscraper: '#3559a8',
  station: '#3ba7b5',
  industrial: '#7c7f8c',
  garage: '#9a8b6a',
  shed: '#a99d82',
  auto: '#9aa3ad',
};

export const typeKey = (meta: BuildingMeta): string => meta.type ?? 'auto';

export interface PickerMap {
  setArea(result: BuildResult | null): void;
  /** Selects a building (null clears); `focus` pans and zooms to it. */
  setSelected(index: number | null, focus?: boolean): void;
  /** Buildings matching the search; null = no filter. Others are drawn faded. */
  setMatches(indices: readonly number[] | null): void;
  fit(): void;
}

export interface PickerOptions {
  onSelect(index: number): void;
  /** Double click: select and load. */
  onActivate(index: number): void;
}

interface Item {
  path: Path2D;
  outer: readonly Vec2[];
  holes: readonly (readonly Vec2[])[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

interface Theme {
  bg: string;
  text: string;
  muted: string;
  road: string;
  path: string;
  rail: string;
  stroke: string;
  select: string;
}

function readTheme(): Theme {
  const v = (name: string, fallback: string): string => cssVar(name) || fallback;
  return {
    bg: v('--plan-bg', '#fbfbfc'),
    text: v('--fg', '#1f2328'),
    muted: v('--muted', '#6b7280'),
    road: v('--picker-road', '#c9ccd2'),
    path: v('--picker-path', '#b9a98f'),
    rail: v('--picker-rail', '#6d6f75'),
    stroke: v('--picker-stroke', 'rgba(0,0,0,0.45)'),
    select: v('--accent', '#e07a00'),
  };
}

function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function itemOf(polygon: Polygon, area: number): Item {
  const path = new Path2D();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const rings = [polygon.outer, ...(polygon.holes ?? [])];
  for (const ring of rings) {
    ring.forEach(([x, y], i) => {
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    path.closePath();
  }
  return { path, outer: polygon.outer, holes: polygon.holes ?? [], minX, minY, maxX, maxY, area };
}

export function createPickerMap(container: HTMLElement, options: PickerOptions): PickerMap {
  const canvas = h('canvas', { attrs: { tabindex: 0, 'aria-label': 'Map of the loaded buildings' } });
  const tooltip = h('div', { class: 'picker-tooltip', attrs: { hidden: true } });
  const hint = h('div', { class: 'picker-hint' }, 'drag = pan · wheel = zoom · click = select');
  container.append(canvas, tooltip, hint);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  let theme = readTheme();
  let result: BuildResult | null = null;
  let items: Item[] = [];
  let roadPaths: { path: Path2D; width: number; kind: 'road' | 'path' | 'rail' }[] = [];
  let selected: number | null = null;
  let hover: number | null = null;
  let matches: Set<number> | null = null;
  let groupOfSelected = new Set<number>();
  let centre: Vec2 = [0, 0];
  let scale = 2; // pixels per metre
  let width = 0;
  let height = 0;
  let hatch: CanvasPattern | null = null;
  let drag: { x: number; y: number; centre: Vec2; moved: boolean } | null = null;

  const toWorld = (x: number, y: number): Vec2 => [
    centre[0] + (x - width / 2) / scale,
    centre[1] - (y - height / 2) / scale,
  ];
  const eventPos = (e: MouseEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function makeHatch(): CanvasPattern | null {
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const t = tile.getContext('2d');
    if (!t) return null;
    t.strokeStyle = theme.text;
    t.globalAlpha = 0.55;
    t.lineWidth = 1.2;
    t.beginPath();
    t.moveTo(0, 8);
    t.lineTo(8, 0);
    t.moveTo(-2, 2);
    t.lineTo(2, -2);
    t.moveTo(6, 10);
    t.lineTo(10, 6);
    t.stroke();
    return ctx.createPattern(tile, 'repeat');
  }
  hatch = makeHatch();

  function hit(x: number, y: number): number | null {
    const p = toWorld(x, y);
    const slack = 2 / scale;
    let best: number | null = null;
    let bestArea = Number.POSITIVE_INFINITY;
    items.forEach((it, i) => {
      if (
        p[0] < it.minX - slack ||
        p[0] > it.maxX + slack ||
        p[1] < it.minY - slack ||
        p[1] > it.maxY + slack
      )
        return;
      if (!pointInRing(p, it.outer) || it.holes.some((hole) => pointInRing(p, hole))) return;
      // Smallest wins: a house inside a big block outline should stay pickable.
      if (it.area < bestArea) {
        best = i;
        bestArea = it.area;
      }
    });
    return best;
  }

  function worldTransform(): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(
      dpr * scale,
      0,
      0,
      -dpr * scale,
      dpr * (width / 2 - centre[0] * scale),
      dpr * (height / 2 + centre[1] * scale),
    );
  }

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);
    if (!result) {
      ctx.fillStyle = theme.muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Load a file, a location or the sample to see buildings here.', width / 2, height / 2);
      ctx.textAlign = 'start';
      return;
    }
    worldTransform();
    const px = 1 / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const r of roadPaths) {
      // Roads at true width; paths and rails as thin lines so they do not hide buildings.
      ctx.strokeStyle = r.kind === 'rail' ? theme.rail : r.kind === 'path' ? theme.path : theme.road;
      ctx.lineWidth =
        r.kind === 'road' ? Math.max(1.5 * px, r.width) : Math.max(px, Math.min(r.width * 0.4, 1));
      ctx.setLineDash(r.kind === 'rail' ? [6 * px, 4 * px] : []);
      ctx.stroke(r.path);
    }
    ctx.setLineDash([]);

    const meta = result.meta;
    if (hatch) {
      const inv = 1 / (dpr * scale);
      hatch.setTransform(new DOMMatrix([inv, 0, 0, -inv, 0, 0]));
    }
    items.forEach((it, i) => {
      const m = meta[i] as BuildingMeta;
      const faded = matches !== null && !matches.has(i);
      ctx.globalAlpha = faded ? 0.18 : m.special ? 0.5 : 0.8;
      ctx.fillStyle = TYPE_COLOURS[typeKey(m)] ?? (TYPE_COLOURS.auto as string);
      ctx.fill(it.path, 'evenodd');
      if (m.special && hatch && !faded) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = hatch;
        ctx.fill(it.path, 'evenodd');
      }
      ctx.globalAlpha = faded ? 0.25 : 1;
      ctx.strokeStyle = theme.stroke;
      ctx.lineWidth = 0.75 * px;
      ctx.stroke(it.path);
    });
    ctx.globalAlpha = 1;

    for (const i of groupOfSelected) {
      const it = items[i];
      if (!it) continue;
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.stroke(it.path);
    }
    ctx.setLineDash([]);
    const outline = (i: number | null, lineWidth: number, fill: boolean): void => {
      const it = i === null ? undefined : items[i];
      if (!it) return;
      if (fill) {
        // A halo in the background colour keeps the accent outline visible on any type colour.
        ctx.strokeStyle = theme.bg;
        ctx.lineWidth = (lineWidth + 3) * px;
        ctx.stroke(it.path);
      }
      ctx.strokeStyle = theme.select;
      ctx.lineWidth = lineWidth * px;
      ctx.stroke(it.path);
    };
    if (hover !== selected) outline(hover, 2, false);
    outline(selected, 3, true);

    drawOverlay();
  }

  function drawOverlay(): void {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Scale bar: a round length near 100 px.
    const target = 100 / scale;
    const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000];
    const len = steps.find((s) => s >= target) ?? 2000;
    const bar = len * scale;
    ctx.strokeStyle = theme.text;
    ctx.fillStyle = theme.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, height - 14);
    ctx.lineTo(12 + bar, height - 14);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${len} m`, 16 + bar, height - 10);
    ctx.textAlign = 'center';
    ctx.fillText('N', width - 18, 18);
    ctx.beginPath();
    ctx.moveTo(width - 18, 24);
    ctx.lineTo(width - 22, 36);
    ctx.lineTo(width - 14, 36);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'start';
  }

  function showTooltip(x: number, y: number): void {
    const m = hover === null ? undefined : result?.meta[hover];
    if (!m) {
      tooltip.hidden = true;
      return;
    }
    const addr = addressOf(m);
    const lines = [
      buildingLabel(m),
      m.tags.name && addr ? addr : '',
      `${m.type ?? 'auto'}${m.special ? ' · special (massing)' : ''} — ${m.typeReason}`,
      `${m.osmType} ${m.osmId}${m.ring ? ` ring ${m.ring}` : ''}`,
    ].filter(Boolean);
    tooltip.replaceChildren(
      h('strong', {}, lines[0] as string),
      ...lines.slice(1).map((l) => h('div', {}, l)),
    );
    tooltip.hidden = false;
    const r = container.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(x + 14, r.width - tw - 6)}px`;
    tooltip.style.top = `${y + 16 + th > r.height ? y - th - 10 : y + 16}px`;
  }

  // --- input ---

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = eventPos(e);
    drag = { x, y, centre, moved: false };
  });
  window.addEventListener('mousemove', (e) => {
    const [x, y] = eventPos(e);
    if (drag) {
      if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
      if (drag.moved) {
        centre = [drag.centre[0] - (x - drag.x) / scale, drag.centre[1] + (y - drag.y) / scale];
        tooltip.hidden = true;
        draw();
      }
      return;
    }
    if (e.target !== canvas) {
      if (hover !== null) {
        hover = null;
        tooltip.hidden = true;
        draw();
      }
      return;
    }
    const next = hit(x, y);
    if (next !== hover) {
      hover = next;
      draw();
    }
    canvas.style.cursor = hover === null ? 'grab' : 'pointer';
    showTooltip(x, y);
  });
  window.addEventListener('mouseup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved || e.target !== canvas) return;
    const [x, y] = eventPos(e);
    const i = hit(x, y);
    if (i !== null) options.onSelect(i);
  });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = eventPos(e);
    const i = hit(x, y);
    if (i !== null) options.onActivate(i);
  });
  canvas.addEventListener('mouseleave', () => {
    if (drag) return;
    hover = null;
    tooltip.hidden = true;
    draw();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [x, y] = eventPos(e);
      const before = toWorld(x, y);
      scale = Math.max(0.2, Math.min(60, scale * Math.exp(-e.deltaY * 0.0015)));
      const after = toWorld(x, y);
      centre = [centre[0] + before[0] - after[0], centre[1] + before[1] - after[1]];
      draw();
    },
    { passive: false },
  );

  // --- view ---

  function fitBox(minX: number, minY: number, maxX: number, maxY: number, margin: number): void {
    if (width === 0 || !Number.isFinite(minX)) return;
    centre = [(minX + maxX) / 2, (minY + maxY) / 2];
    scale = Math.max(
      0.2,
      Math.min(60, Math.min(width / (maxX - minX + 2 * margin), height / (maxY - minY + 2 * margin))),
    );
    draw();
  }

  function fit(): void {
    if (!items.length) {
      draw();
      return;
    }
    let [minX, minY, maxX, maxY] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const it of items) {
      minX = Math.min(minX, it.minX);
      minY = Math.min(minY, it.minY);
      maxX = Math.max(maxX, it.maxX);
      maxY = Math.max(maxY, it.maxY);
    }
    fitBox(minX, minY, maxX, maxY, 10);
  }

  function resize(): void {
    const r = container.getBoundingClientRect();
    const wasEmpty = width === 0;
    width = Math.floor(r.width);
    height = Math.floor(r.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (wasEmpty && width > 0) {
      if (selected !== null) focusOn(selected);
      else fit();
    } else draw();
  }
  new ResizeObserver(resize).observe(container);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    theme = readTheme();
    hatch = makeHatch();
    draw();
  });

  function focusOn(index: number): void {
    const it = items[index];
    if (!it) return;
    // Show the building with some of its surroundings (neighbours, the street).
    const pad = Math.max(35, Math.max(it.maxX - it.minX, it.maxY - it.minY) * 0.6);
    fitBox(it.minX, it.minY, it.maxX, it.maxY, pad);
  }

  return {
    setArea(next) {
      result = next;
      items = next ? next.inputs.map((input, i) => itemOf(input.footprint, next.meta[i]?.area ?? 0)) : [];
      roadPaths = (next?.roads ?? []).map((r) => {
        const path = new Path2D();
        r.line.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
        return { path, width: r.width, kind: r.kind };
      });
      selected = null;
      hover = null;
      matches = null;
      groupOfSelected = new Set();
      fit();
    },
    setSelected(index, focus = false) {
      selected = index;
      groupOfSelected = new Set();
      const key = index === null ? undefined : result?.meta[index]?.groupKey;
      if (key !== undefined && result) {
        result.meta.forEach((m, i) => {
          if (i !== index && m.groupKey === key) groupOfSelected.add(i);
        });
      }
      if (focus && index !== null && width > 0) focusOn(index);
      else draw();
    },
    setMatches(indices) {
      matches = indices ? new Set(indices) : null;
      draw();
    },
    fit,
  };
}
