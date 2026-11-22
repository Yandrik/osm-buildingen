/**
 * 2D plan editor (canvas, north up, metres). Edits the footprint, neighbours and roads in
 * the store and draws the generator's wall context on top.
 *
 * Mouse: drag a vertex to move it; click an edge to insert a vertex; right-click a vertex
 * (or select it and press Delete) to remove it; drag inside a polygon or Shift-drag any
 * edge to move the whole object; drag empty space to pan; wheel to zoom.
 */
import type { BuildingInput, NeighbourInput, RoadInput, Vec2 } from '@osm-buildingen/core';
import { entranceInfo } from './analysis';
import { clear, cssVar, fmt, h } from './dom';
import {
  type GenerationState,
  type PlanTool,
  type Selection,
  type Store,
  type StudioState,
  getRing,
  patchInput,
  prune,
  setNeighbour,
  setRing,
  setRoad,
} from './state';

export interface PlanEditor {
  fit(): void;
}

// ---------------------------------------------------------------------------
// Objects in the plan
// ---------------------------------------------------------------------------

type Target =
  | { kind: 'footprint'; ring: number }
  | { kind: 'neighbour'; index: number }
  | { kind: 'road'; index: number };

const isClosed = (t: Target): boolean => t.kind !== 'road';
const minPoints = (t: Target): number => (isClosed(t) ? 3 : 2);

function pointsOf(input: BuildingInput, t: Target): readonly Vec2[] {
  if (t.kind === 'footprint') return getRing(input.footprint, t.ring);
  if (t.kind === 'neighbour') return input.neighbours?.[t.index]?.footprint.outer ?? [];
  return input.roads?.[t.index]?.line ?? [];
}

function withPoints(input: BuildingInput, t: Target, points: Vec2[]): BuildingInput {
  if (t.kind === 'footprint') return setRing(input, t.ring, points);
  if (t.kind === 'neighbour') {
    const n = input.neighbours?.[t.index];
    return n ? setNeighbour(input, t.index, { ...n, footprint: { ...n.footprint, outer: points } }) : input;
  }
  const r = input.roads?.[t.index];
  return r ? setRoad(input, t.index, { ...r, line: points }) : input;
}

/** All objects, in hit-test priority order: footprint first, then neighbours, then roads. */
function targets(input: BuildingInput): Target[] {
  const list: Target[] = [{ kind: 'footprint', ring: 0 }];
  (input.footprint.holes ?? []).forEach((_, i) => list.push({ kind: 'footprint', ring: i + 1 }));
  (input.neighbours ?? []).forEach((_, index) => list.push({ kind: 'neighbour', index }));
  (input.roads ?? []).forEach((_, index) => list.push({ kind: 'road', index }));
  return list;
}

function toSelection(t: Target, vertex: number | null): Selection {
  return t.kind === 'footprint' ? { kind: 'footprint', ring: t.ring, vertex } : { ...t, vertex };
}

function selectionTarget(s: Selection): Target {
  return s.kind === 'footprint' ? { kind: 'footprint', ring: s.ring } : { kind: s.kind, index: s.index };
}

const sameTarget = (a: Target, b: Target): boolean =>
  a.kind === b.kind &&
  (a.kind === 'footprint' ? a.ring === (b as typeof a).ring : a.index === (b as typeof a).index);

/** Snap to 10 cm so edited coordinates stay readable in the JSON. */
const snap = (v: number): number => Math.round(v * 10) / 10;

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

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; distance: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  const point: Vec2 = [a[0] + dx * t, a[1] + dy * t];
  return { point, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) };
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

interface PlanTheme {
  bg: string;
  grid: string;
  gridMajor: string;
  text: string;
  footprint: string;
  footprintFill: string;
  neighbour: string;
  neighbourFill: string;
  road: string;
  select: string;
  blocked: string;
  shared: string;
  street: string;
  door: string;
}

function readTheme(): PlanTheme {
  const v = (name: string, fallback: string): string => cssVar(name) || fallback;
  return {
    bg: v('--plan-bg', '#fafafa'),
    grid: v('--plan-grid', '#e6e6e6'),
    gridMajor: v('--plan-grid-major', '#cccccc'),
    text: v('--fg', '#222'),
    footprint: v('--plan-footprint', '#2a5db0'),
    footprintFill: v('--plan-footprint-fill', 'rgba(42,93,176,0.12)'),
    neighbour: v('--plan-neighbour', '#777'),
    neighbourFill: v('--plan-neighbour-fill', 'rgba(120,120,120,0.25)'),
    road: v('--plan-road', 'rgba(90,90,90,0.35)'),
    select: v('--accent', '#e07a00'),
    blocked: v('--plan-blocked', '#e53935'),
    shared: v('--plan-shared', '#7b1010'),
    street: v('--plan-street', '#1e9e57'),
    door: v('--plan-door', '#e07a00'),
  };
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

type Drag =
  | { kind: 'vertex'; target: Target; vertex: number }
  | { kind: 'move'; target: Target; start: Vec2; original: BuildingInput }
  | { kind: 'pan'; startX: number; startY: number; centre: Vec2 };

const VERTEX_PX = 7;
const EDGE_PX = 6;

export function createPlanEditor(
  container: HTMLElement,
  store: Store<StudioState>,
  generation: Store<GenerationState>,
): PlanEditor {
  const toolbar = h('div', { class: 'plan-toolbar' });
  const props = h('div', { class: 'plan-props' });
  const canvas = h('canvas', { attrs: { tabindex: 0 } });
  const status = h('div', { class: 'plan-status' });
  const hint = h('div', { class: 'plan-hint' });
  const canvasWrap = h('div', { class: 'plan-canvas' }, canvas, status, hint);
  container.append(toolbar, canvasWrap, props);

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let theme = readTheme();
  let centre: Vec2 = [0, 0];
  let scale = 12; // pixels per metre
  let drag: Drag | null = null;
  let draft: Vec2[] = [];
  let mouse: Vec2 | null = null;
  let width = 0;
  let height = 0;

  const input = (): BuildingInput => store.get().input;
  const setInput = (next: BuildingInput): void => store.update((s) => ({ ...s, input: next }));
  const setSelection = (selection: Selection | null): void =>
    store.update((s) => ({ ...s, ui: { ...s.ui, selection } }));
  const setTool = (tool: PlanTool): void => {
    draft = [];
    store.update((s) => ({ ...s, ui: { ...s.ui, tool } }));
  };

  const toScreen = (p: Vec2): Vec2 => [
    width / 2 + (p[0] - centre[0]) * scale,
    height / 2 - (p[1] - centre[1]) * scale,
  ];
  const toWorld = (x: number, y: number): Vec2 => [
    centre[0] + (x - width / 2) / scale,
    centre[1] - (y - height / 2) / scale,
  ];
  const eventWorld = (e: MouseEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return toWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // --- hit testing (distances in screen pixels) ---

  function hitVertex(p: Vec2): { target: Target; vertex: number } | null {
    const sel = store.get().ui.selection;
    const list = targets(input());
    // The selected object wins when vertices overlap (shared corners with a neighbour).
    if (sel) list.unshift(selectionTarget(sel));
    for (const t of list) {
      const pts = pointsOf(input(), t);
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i] as Vec2;
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) * scale <= VERTEX_PX) return { target: t, vertex: i };
      }
    }
    return null;
  }

  function hitEdge(p: Vec2): { target: Target; after: number; point: Vec2 } | null {
    for (const t of targets(input())) {
      const pts = pointsOf(input(), t);
      const n = isClosed(t) ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const c = closestOnSegment(p, pts[i] as Vec2, pts[(i + 1) % pts.length] as Vec2);
        if (c.distance * scale <= EDGE_PX) return { target: t, after: i, point: c.point };
      }
    }
    return null;
  }

  function hitInterior(p: Vec2): Target | null {
    const inp = input();
    // Holes are not "inside" the footprint; test them first.
    for (const t of targets(inp)) {
      if (t.kind === 'footprint' && t.ring > 0 && pointInRing(p, pointsOf(inp, t))) return t;
    }
    if (pointInRing(p, inp.footprint.outer)) return { kind: 'footprint', ring: 0 };
    const ns = inp.neighbours ?? [];
    for (let i = 0; i < ns.length; i++) {
      if (pointInRing(p, (ns[i] as NeighbourInput).footprint.outer)) return { kind: 'neighbour', index: i };
    }
    return null;
  }

  // --- editing operations ---

  function removeVertex(t: Target, vertex: number): void {
    const pts = [...pointsOf(input(), t)];
    if (pts.length <= minPoints(t)) return;
    pts.splice(vertex, 1);
    setInput(withPoints(input(), t, pts));
    setSelection(toSelection(t, null));
  }

  function removeObject(t: Target): void {
    if (t.kind === 'footprint') {
      if (t.ring === 0) return; // the footprint itself cannot be deleted
      const holes = [...(input().footprint.holes ?? [])];
      holes.splice(t.ring - 1, 1);
      setInput(
        patchInput(input(), {
          footprint: { outer: input().footprint.outer, ...(holes.length ? { holes } : {}) },
        }),
      );
    } else if (t.kind === 'neighbour') setInput(setNeighbour(input(), t.index, null));
    else setInput(setRoad(input(), t.index, null));
    setSelection(null);
  }

  function deleteSelection(): void {
    const sel = store.get().ui.selection;
    if (!sel) return;
    if (sel.vertex !== null) removeVertex(selectionTarget(sel), sel.vertex);
    else removeObject(selectionTarget(sel));
  }

  function finishDraft(): void {
    const tool = store.get().ui.tool;
    const pts = draft;
    const need = tool === 'road' ? 2 : 3;
    if (pts.length < need) return;
    let inp = input();
    let selection: Selection;
    if (tool === 'neighbour') {
      const index = inp.neighbours?.length ?? 0;
      inp = setNeighbour(inp, index, { footprint: { outer: pts } });
      selection = { kind: 'neighbour', index, vertex: null };
    } else if (tool === 'road') {
      const index = inp.roads?.length ?? 0;
      inp = setRoad(inp, index, { line: pts, width: 6, kind: 'road' });
      selection = { kind: 'road', index, vertex: null };
    } else {
      const ring = (inp.footprint.holes?.length ?? 0) + 1;
      inp = setRing(inp, ring, pts);
      selection = { kind: 'footprint', ring, vertex: null };
    }
    draft = [];
    store.set({ input: inp, ui: { ...store.get().ui, tool: 'select', selection } });
  }

  // --- mouse ---

  canvas.addEventListener('mousedown', (e) => {
    canvas.focus();
    const p = eventWorld(e);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, centre };
      return;
    }
    if (e.button !== 0) return;
    const tool = store.get().ui.tool;
    if (tool !== 'select') {
      const first = draft[0];
      if (
        first &&
        tool !== 'road' &&
        draft.length >= 3 &&
        Math.hypot(first[0] - p[0], first[1] - p[1]) * scale <= VERTEX_PX
      ) {
        finishDraft();
      } else {
        draft.push([snap(p[0]), snap(p[1])]);
      }
      draw();
      return;
    }
    const v = e.shiftKey ? null : hitVertex(p);
    if (v) {
      setSelection(toSelection(v.target, v.vertex));
      drag = { kind: 'vertex', target: v.target, vertex: v.vertex };
      return;
    }
    const edge = hitEdge(p);
    if (edge && !e.shiftKey) {
      const pts = [...pointsOf(input(), edge.target)];
      const vertex = edge.after + 1;
      pts.splice(vertex, 0, [snap(edge.point[0]), snap(edge.point[1])]);
      setInput(withPoints(input(), edge.target, pts));
      setSelection(toSelection(edge.target, vertex));
      drag = { kind: 'vertex', target: edge.target, vertex };
      return;
    }
    const body = edge?.target ?? hitInterior(p);
    if (body) {
      setSelection(toSelection(body, null));
      drag = { kind: 'move', target: body, start: p, original: input() };
      return;
    }
    setSelection(null);
    drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, centre };
  });

  window.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    mouse = inside || drag ? eventWorld(e) : null;
    if (!drag) {
      if (inside) {
        updateStatus();
        if (draft.length) draw();
      }
      return;
    }
    const p = eventWorld(e);
    if (drag.kind === 'pan') {
      centre = [
        drag.centre[0] - (e.clientX - drag.startX) / scale,
        drag.centre[1] + (e.clientY - drag.startY) / scale,
      ];
      draw();
    } else if (drag.kind === 'vertex') {
      const pts = [...pointsOf(input(), drag.target)];
      pts[drag.vertex] = [snap(p[0]), snap(p[1])];
      setInput(withPoints(input(), drag.target, pts));
    } else {
      const dx = snap(p[0] - drag.start[0]);
      const dy = snap(p[1] - drag.start[1]);
      const shift = (pts: readonly Vec2[]): Vec2[] => pts.map(([x, y]) => [snap(x + dx), snap(y + dy)]);
      const t = drag.target;
      const orig = drag.original;
      if (t.kind === 'footprint') {
        // The outer ring carries its holes along; a hole moves alone.
        if (t.ring === 0) {
          const holes = orig.footprint.holes?.map(shift);
          setInput(
            patchInput(input(), {
              footprint: { outer: shift(orig.footprint.outer), ...(holes ? { holes } : {}) },
            }),
          );
        } else setInput(setRing(input(), t.ring, shift(pointsOf(orig, t))));
      } else setInput(withPoints(input(), t, shift(pointsOf(orig, t))));
    }
    updateStatus();
  });

  window.addEventListener('mouseup', () => {
    drag = null;
  });

  canvas.addEventListener('dblclick', (e) => {
    if (store.get().ui.tool === 'select') return;
    e.preventDefault();
    // The two clicks of the double-click already added the same point twice.
    draft = draft.slice(0, -1);
    finishDraft();
    draw();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (store.get().ui.tool !== 'select') {
      draft.pop();
      draw();
      return;
    }
    const v = hitVertex(eventWorld(e));
    if (v) removeVertex(v.target, v.vertex);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const before = eventWorld(e);
      scale = Math.max(1, Math.min(200, scale * Math.exp(-e.deltaY * 0.0015)));
      const after = eventWorld(e);
      centre = [centre[0] + before[0] - after[0], centre[1] + before[1] - after[1]];
      draw();
    },
    { passive: false },
  );

  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === 'Escape') {
      if (draft.length) draft = [];
      else if (store.get().ui.tool !== 'select') setTool('select');
      else setSelection(null);
      draw();
    } else if (e.key === 'Enter') finishDraft();
  });

  // --- toolbar and selected object properties ---

  const toolButtons: Record<PlanTool, HTMLButtonElement> = {
    select: h(
      'button',
      { title: 'Select, drag and edit (Esc)', on: { click: () => setTool('select') } },
      'Select',
    ),
    neighbour: h(
      'button',
      {
        title: 'Click points, double-click or click the first point to close',
        on: { click: () => setTool('neighbour') },
      },
      '+ Neighbour',
    ),
    road: h(
      'button',
      { title: 'Click points, double-click or Enter to finish', on: { click: () => setTool('road') } },
      '+ Road',
    ),
    hole: h(
      'button',
      { title: 'Draw a courtyard hole in the footprint', on: { click: () => setTool('hole') } },
      '+ Hole',
    ),
  };
  toolbar.append(
    ...Object.values(toolButtons),
    h('span', { class: 'spacer' }),
    h(
      'button',
      { title: 'Delete selected vertex or object (Del)', on: { click: deleteSelection } },
      'Delete',
    ),
    h('button', { title: 'Zoom to the footprint and neighbours', on: { click: () => fit() } }, 'Fit'),
  );

  let propsKey = '';
  function renderProps(): void {
    const { input: inp, ui } = store.get();
    const sel = ui.selection;
    const t = sel ? selectionTarget(sel) : null;
    const obj = !t
      ? null
      : t.kind === 'neighbour'
        ? inp.neighbours?.[t.index]
        : t.kind === 'road'
          ? inp.roads?.[t.index]
          : inp.footprint;
    const key = `${JSON.stringify(sel)}|${JSON.stringify(obj)}`;
    // Rebuilding while the user types would steal focus.
    if (key === propsKey || props.contains(document.activeElement)) return;
    propsKey = key;
    clear(props);
    if (!sel || !t) {
      props.append(h('span', { class: 'muted' }, 'Nothing selected. Click a vertex, edge or polygon.'));
      return;
    }
    const pts = pointsOf(inp, t);
    const vertex = sel.vertex !== null ? pts[sel.vertex] : undefined;
    const label =
      t.kind === 'footprint'
        ? t.ring === 0
          ? 'Footprint'
          : `Hole ${t.ring}`
        : `${t.kind === 'road' ? 'Road' : 'Neighbour'} ${t.index + 1}`;
    props.append(h('strong', {}, label), h('span', { class: 'muted' }, `${pts.length} points`));
    if (vertex)
      props.append(
        h('span', { class: 'muted' }, `vertex ${sel.vertex}: (${fmt(vertex[0])}, ${fmt(vertex[1])})`),
      );
    if (t.kind === 'neighbour') {
      const n = obj as NeighbourInput;
      const update = (patch: Partial<NeighbourInput>): void => {
        const next = { ...n, ...patch };
        setInput(setNeighbour(input(), t.index, prune({ ...next, sameGroup: next.sameGroup || undefined })));
      };
      props.append(
        numberField('height', n.height, 'unknown', (v) => update({ height: v })),
        checkField('same plot', n.sameGroup === true, (v) => update({ sameGroup: v })),
      );
    } else if (t.kind === 'road') {
      const r = obj as RoadInput;
      const update = (patch: Partial<RoadInput>): void => {
        const next = { ...r, ...patch };
        setInput(setRoad(input(), t.index, prune({ ...next, passage: next.passage || undefined })));
      };
      const kind = h(
        'select',
        { on: { change: () => update({ kind: kind.value as RoadInput['kind'] }) } },
        ...(['road', 'path', 'rail'] as const).map((k) =>
          h('option', { attrs: { value: k, selected: (r.kind ?? 'road') === k } }, k),
        ),
      );
      props.append(
        numberField('width', r.width, 'auto', (v) => update({ width: v })),
        h('label', {}, 'kind ', kind),
        checkField('passage', r.passage === true, (v) => update({ passage: v })),
      );
    }
  }

  function numberField(
    label: string,
    value: number | undefined,
    placeholder: string,
    set: (v: number | undefined) => void,
  ): HTMLElement {
    const el = h('input', { attrs: { type: 'number', step: 0.5, placeholder, value: value ?? '' } });
    el.addEventListener('change', () => set(el.value === '' ? undefined : Number(el.value)));
    return h('label', {}, `${label} `, el);
  }

  function checkField(label: string, value: boolean, set: (v: boolean) => void): HTMLElement {
    const el = h('input', { attrs: { type: 'checkbox', checked: value } });
    el.addEventListener('change', () => set(el.checked));
    return h('label', {}, el, ` ${label}`);
  }

  const HINTS: Record<PlanTool, string> = {
    select:
      'Drag vertex · click edge = add · right-click = remove · drag inside / Shift-drag edge = move · wheel = zoom',
    neighbour:
      'Click to add points · click first point or double-click to close · right-click = undo point · Esc',
    road: 'Click to add points · double-click or Enter to finish · right-click = undo point · Esc',
    hole: 'Click to add points inside the footprint · click first point or double-click to close · Esc',
  };

  function updateToolbar(): void {
    const { tool } = store.get().ui;
    for (const [k, b] of Object.entries(toolButtons)) b.classList.toggle('active', k === tool);
    hint.textContent = HINTS[tool];
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  function updateStatus(): void {
    status.textContent = mouse ? `x ${fmt(mouse[0], 1)}  y ${fmt(mouse[1], 1)} m` : '';
  }

  // --- drawing ---

  function path(pts: readonly Vec2[], closed: boolean): void {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = toScreen(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (closed) ctx.closePath();
  }

  function drawGrid(): void {
    const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
    const step = steps.find((s) => s * scale >= 14) ?? 100;
    const major = step * 5;
    const [x0, y1] = toWorld(0, 0);
    const [x1, y0] = toWorld(width, height);
    ctx.lineWidth = 1;
    for (const [s, colour] of [
      [step, theme.grid],
      [major, theme.gridMajor],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
        const sx = Math.round(toScreen([x, 0])[0]) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
      }
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
        const sy = Math.round(toScreen([0, y])[1]) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
      }
      ctx.stroke();
    }
    // Scale bar and north arrow.
    ctx.fillStyle = theme.text;
    ctx.strokeStyle = theme.text;
    ctx.font = '11px system-ui, sans-serif';
    const barPx = major * scale;
    ctx.beginPath();
    ctx.moveTo(12, height - 14);
    ctx.lineTo(12 + barPx, height - 14);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillText(`${major} m`, 16 + barPx, height - 10);
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

  function drawVertices(pts: readonly Vec2[], colour: string, selected: number | null): void {
    pts.forEach((p, i) => {
      const [x, y] = toScreen(p);
      ctx.beginPath();
      ctx.arc(x, y, i === selected ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? theme.select : theme.bg;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawContext(): void {
    const gen = generation.get();
    // Overlays describe the last good mesh; hide them when they no longer match the input.
    const debug = gen.meshInput === input() ? gen.mesh?.debug : undefined;
    if (!debug) return;
    const { streetWall, entrances } = entranceInfo(debug);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    debug.walls.forEach((wall, i) => {
      const c = debug.context[i];
      const along = (d: number, out: number): Vec2 => {
        const [x, y] = toScreen([wall.a[0] + wall.dir[0] * d, wall.a[1] + wall.dir[1] * d]);
        // Screen y is flipped, so the outward normal's y flips too.
        return [x + wall.normal[0] * out, y - wall.normal[1] * out];
      };
      if (i === streetWall) {
        ctx.strokeStyle = theme.street;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(...along(0, 0));
        ctx.lineTo(...along(wall.length, 0));
        ctx.stroke();
      }
      const spans = (list: readonly { from: number; to: number }[], colour: string, offset: number): void => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 4;
        for (const s of list) {
          ctx.beginPath();
          ctx.moveTo(...along(s.from, offset));
          ctx.lineTo(...along(s.to, offset));
          ctx.stroke();
        }
      };
      if (c) {
        spans(c.blocked, theme.blocked, 4);
        spans(c.shared, theme.shared, 8);
      }
      const [lx, ly] = along(wall.length / 2, 16);
      const label = `${wall.index}${c && c.streetScore > 0 ? ` · ${fmt(c.streetScore)}` : ''}`;
      ctx.fillStyle = theme.bg;
      const w = ctx.measureText(label).width + 6;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(lx - w / 2, ly - 7, w, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = i === streetWall ? theme.street : theme.text;
      ctx.fillText(label, lx, ly);
    });
    for (const e of entrances) {
      const [x, y] = toScreen(e.position);
      ctx.fillStyle = e.tile === 'garage_door' ? theme.neighbour : theme.door;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  function draw(): void {
    const { input: inp, ui } = store.get();
    const sel = ui.selection;
    const selTarget = sel ? selectionTarget(sel) : null;
    const isSel = (t: Target): boolean => selTarget !== null && sameTarget(selTarget, t);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);
    drawGrid();

    (inp.roads ?? []).forEach((r, index) => {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      path(r.line, false);
      ctx.strokeStyle = theme.road;
      ctx.lineWidth = Math.max(2, (r.width ?? 6) * scale);
      ctx.stroke();
      path(r.line, false);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = isSel({ kind: 'road', index }) ? theme.select : theme.neighbour;
      ctx.lineWidth = isSel({ kind: 'road', index }) ? 2 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
    });
    (inp.neighbours ?? []).forEach((n, index) => {
      path(n.footprint.outer, true);
      ctx.fillStyle = theme.neighbourFill;
      ctx.fill();
      ctx.strokeStyle = isSel({ kind: 'neighbour', index }) ? theme.select : theme.neighbour;
      ctx.lineWidth = isSel({ kind: 'neighbour', index }) ? 2 : 1;
      ctx.setLineDash(n.sameGroup ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (n.height !== undefined) {
        const [cx, cy] = toScreen(centroid(n.footprint.outer));
        ctx.fillStyle = theme.neighbour;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${fmt(n.height, 1)} m`, cx, cy);
        ctx.textAlign = 'start';
      }
    });

    // Footprint with holes (even-odd fill shows the courtyard).
    ctx.beginPath();
    for (const ring of [inp.footprint.outer, ...(inp.footprint.holes ?? [])]) {
      ring.forEach((p, i) => {
        const [x, y] = toScreen(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = theme.footprintFill;
    ctx.fill('evenodd');
    for (const t of targets(inp)) {
      if (t.kind !== 'footprint') continue;
      path(pointsOf(inp, t), true);
      ctx.strokeStyle = isSel(t) ? theme.select : theme.footprint;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawContext();

    for (const t of targets(inp)) {
      const colour = t.kind === 'footprint' ? theme.footprint : theme.neighbour;
      drawVertices(
        pointsOf(inp, t),
        isSel(t) ? theme.select : colour,
        isSel(t) ? (sel?.vertex ?? null) : null,
      );
    }

    if (draft.length) {
      const pts = mouse ? [...draft, mouse] : draft;
      path(pts, false);
      ctx.strokeStyle = theme.select;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      drawVertices(draft, theme.select, null);
    }
  }

  function centroid(ring: readonly Vec2[]): Vec2 {
    let x = 0;
    let y = 0;
    for (const p of ring) {
      x += p[0];
      y += p[1];
    }
    return [x / Math.max(ring.length, 1), y / Math.max(ring.length, 1)];
  }

  function fit(): void {
    const inp = input();
    const pts = [...inp.footprint.outer, ...(inp.neighbours ?? []).flatMap((n) => n.footprint.outer)];
    if (!pts.length || width === 0) return;
    // Roads can be long: include only the point of each road nearest to the footprint.
    const c = centroid(inp.footprint.outer);
    for (const r of inp.roads ?? []) {
      let best: { point: Vec2; distance: number } | null = null;
      for (let i = 0; i + 1 < r.line.length; i++) {
        const hit = closestOnSegment(c, r.line[i] as Vec2, r.line[i + 1] as Vec2);
        if (!best || hit.distance < best.distance) best = hit;
      }
      if (best && best.distance < 60) pts.push(best.point);
    }
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    centre = [(minX + maxX) / 2, (minY + maxY) / 2];
    scale = Math.max(1, Math.min(80, Math.min(width / (maxX - minX + 8), height / (maxY - minY + 8))));
    draw();
  }

  function resize(): void {
    const r = canvasWrap.getBoundingClientRect();
    const wasEmpty = width === 0;
    width = Math.floor(r.width);
    height = Math.floor(r.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (wasEmpty && width > 0) fit();
    else draw();
  }
  new ResizeObserver(resize).observe(canvasWrap);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    theme = readTheme();
    propsKey = '';
    draw();
  });

  const refresh = (): void => {
    updateToolbar();
    renderProps();
    draw();
  };
  store.subscribe(refresh);
  generation.subscribe(() => draw());
  refresh();

  return { fit };
}
