/**
 * Viewer entry point: wires settings, data loading, generation, scene and panels.
 *
 * Flow: load (data worker parses and keeps OsmData) -> buildInputs (data worker)
 * -> tiles -> generator pool -> merged tile meshes. A settings change re-enters
 * the flow at the earliest step it affects; newer requests supersede older ones.
 */
import type { Vec2 } from '@osm-buildingen/core';
import type { BuildOptions, LatLonBBox } from '@osm-buildingen/osm';
import sampleUrl from '../../../packages/osm/test/fixtures/ulm-minster.osm?url';
import { type ResolveCache, createResolveCache, inspectBuilding } from './analysis';
import { parseBBox, parseCentre } from './area';
import { type AreaMeta, metaLabel, sameBuilding, skippedText } from './area-build';
import { type BuildOutcome, type DataSource, LoadError, type LoadSummary, createDataClient } from './data';
import { byId } from './dom';
import { type DetailOptions, type Generation, startGeneration } from './generation';
import { POOL_SIZE, createPool } from './generator';
import {
  type OverlayContext,
  colourFor,
  createOverlayLayers,
  needsResolve,
  paintBuilding,
  paintTile,
} from './overlays';
import { createControls } from './panel-controls';
import { createInspector } from './panel-inspector';
import { type BuildingTime, type StatsData, createStats } from './panel-stats';
import { studioLink } from './permalink';
import { attachPicking } from './picking';
import { type ProfileEntry, type ProfileRun, runProfile } from './profile';
import { type Extent, type TileView, createScene } from './scene';
import { type Settings, changed, createStore, loadSettings, needsDebug, saveSettings } from './state';
import './style.css';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const store = createStore<Settings>(loadSettings());
const viewEl = byId<HTMLElement>('view');
const progressEl = byId<HTMLElement>('progress');
const progressBar = byId<HTMLElement>('progress-bar').firstElementChild as HTMLElement;
const areaInfo = byId<HTMLElement>('area-info');
const toastEl = byId<HTMLElement>('toast');
const attributionEl = byId<HTMLElement>('attribution');

function applyThemeAttribute(): void {
  const theme = store.get().theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}
applyThemeAttribute();

const scene = createScene(viewEl);
scene.setShadows(store.get().shadows);
scene.setFog(store.get().fog);
const pool = createPool();
const layers = createOverlayLayers(scene.overlays);

let toastTimer = 0;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('visible'), 2200);
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Map data credit for the loaded source; OpenMapTiles-schema tiles require the OpenMapTiles credit. */
function showAttribution(source: DataSource): void {
  const link = (href: string, text: string): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = text;
    return a;
  };
  const parts: HTMLElement[] = [];
  if (source.kind === 'tiles') {
    if (/openfreemap\.org/.test(source.url)) parts.push(link('https://openfreemap.org/', 'OpenFreeMap'));
    parts.push(link('https://openmaptiles.org/', '© OpenMapTiles'));
  }
  parts.push(link('https://www.openstreetmap.org/copyright', '© OpenStreetMap contributors'));
  attributionEl.replaceChildren(...parts.flatMap((p, i) => (i > 0 ? [' ', p] : [p])));
  attributionEl.hidden = false;
}

// ---------------------------------------------------------------------------
// Session state (what is loaded and shown)
// ---------------------------------------------------------------------------

let lastLoad: { source: DataSource; clip: LatLonBBox | undefined } | null = null;
let summary: LoadSummary | null = null;
let clip: LatLonBBox | undefined;
let build: BuildOutcome | null = null;
let generation: Generation | null = null;
let resolved: ResolveCache | null = null;
let groupSizes = new Map<string, number>();
/** Where each building of the current generation sits in the scene. */
const located = new Map<number, { view: TileView; k: number }>();
let selected: number | null = null;
let fitPending = false;
let profile: ProfileRun | null = null;
let profileProgress: { done: number; total: number } | null = null;
let profileResult: ProfileEntry[] | null = null;
/** Which origin / clip the trees in the scene were placed for; '' = none shown. */
let treesKey = '';
let treeCount: { mapped: number; filled: number; truncated: boolean } | null = null;

const data = createDataClient((message) => controls.setStatus(message, 'busy'));

const detailOptions = (): DetailOptions => {
  const s = store.get();
  return { mode: s.detail, radius: s.autoRadius, debug: needsDebug(s) };
};

// ---------------------------------------------------------------------------
// Loading and building inputs
// ---------------------------------------------------------------------------

async function load(source: DataSource, clipBox: LatLonBBox | undefined): Promise<void> {
  lastLoad = { source, clip: clipBox };
  controls.setLoading(true);
  try {
    const result = await data.load(source);
    if (!result) return; // superseded
    summary = result;
    clip = clipBox;
    fitPending = true;
    select(null);
    clearScene();
    treesKey = '';
    treeCount = null;
    scene.setTrees(null);
    controls.setStatus(
      result.tiles
        ? `Loaded ${result.tiles.count} vector tiles (z${result.tiles.zoom}) from ${result.name}.`
        : `Loaded ${result.name}: ${result.nodes.toLocaleString('en-US')} nodes, ${result.ways.toLocaleString('en-US')} ways.`,
      'info',
    );
    showAttribution(source);
    await rebuild();
  } catch (e) {
    const retryable = e instanceof LoadError && e.retryable;
    controls.setStatus(errorText(e), 'error', retryable);
  } finally {
    controls.setLoading(false);
  }
}

async function rebuild(): Promise<void> {
  if (!summary) return;
  const s = store.get();
  const options: BuildOptions = {
    style: { region: s.region, modernity: s.modernity },
    bbox: clip,
  };
  if (s.seed.trim() !== '') options.seed = s.seed.trim();
  if (s.shopProbability !== null) options.shopProbability = s.shopProbability;
  progressEl.textContent = 'Building inputs…';
  try {
    const out = await data.build(options);
    if (!out) return; // superseded by a newer settings change
    const previous: AreaMeta | undefined = selected !== null ? build?.result.meta[selected] : undefined;
    build = out;
    // The same element keeps its selection (OSM id, or the tile building's stable key).
    const meta: readonly AreaMeta[] = out.result.meta;
    const again = previous ? meta.findIndex((m) => sameBuilding(m, previous)) : -1;
    startTiles(false, again >= 0 ? again : null);
  } catch (e) {
    controls.setStatus(`buildInputs failed: ${errorText(e)}`, 'error');
  }
}

function extentOf(meta: readonly AreaMeta[]): Extent {
  if (meta.length === 0) return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const e = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const {
    centroid: [x, y],
  } of meta) {
    e.minX = Math.min(e.minX, x);
    e.minY = Math.min(e.minY, y);
    e.maxX = Math.max(e.maxX, x);
    e.maxY = Math.max(e.maxY, y);
  }
  return e;
}

function clearScene(): void {
  generation?.cancel();
  generation = null;
  for (const key of [...scene.tiles().keys()]) scene.removeTile(key);
  located.clear();
}

/** Starts a new generation for the current inputs. `clear` drops the old tiles first (tile size change). */
function startTiles(clearOld: boolean, keepSelection: number | null): void {
  if (!build) return;
  const result = build.result;
  generation?.cancel();
  profile?.cancel();
  profile = null;
  profileProgress = null;
  profileResult = null;
  resolved?.cancel();
  resolved = createResolveCache(result.inputs);
  groupSizes = new Map();
  for (const m of result.meta) groupSizes.set(m.groupKey, (groupSizes.get(m.groupKey) ?? 0) + 1);
  if (clearOld) clearScene();
  located.clear();
  selected = keepSelection;

  const extent = extentOf(result.meta);
  scene.setArea(extent);
  scene.setRoads(result.roads);
  if (fitPending) {
    scene.fit(extent);
    fitPending = false;
  }
  showAreaInfo();
  updatePassages();
  void updateTrees();
  ensureResolved();

  generation = startGeneration(result, store.get().tileSize, detailOptions(), scene, pool, POOL_SIZE, {
    onTile(view) {
      view.buildings.forEach((b, k) => located.set(b, { view, k }));
      paintTile(view, colourOf, selected);
      if (selected !== null && view.buildings.includes(selected)) showSelection();
    },
    onProgress(p) {
      progressEl.textContent = `Generating tiles ${p.done} / ${p.total}…`;
      progressBar.style.width = p.total > 0 ? `${(p.done / p.total) * 100}%` : '0';
    },
    onIdle() {
      const g = generation?.stats();
      if (!g) return;
      progressBar.style.width = '0';
      progressEl.textContent = `${g.tilesDone} tiles, ${g.triangles.toLocaleString('en-US')} triangles in ${Math.round(g.wallMs ?? 0)} ms`;
      if (generation && generation.errors.size > 0)
        progressEl.textContent += ` · ${generation.errors.size} failed`;
      if (selected !== null) showSelection();
    },
  });
  showSelection();
}

// ---------------------------------------------------------------------------
// Overlays and selection
// ---------------------------------------------------------------------------

function showAreaInfo(): void {
  if (!build) return;
  const { inputs, origin } = build.result;
  let text = `${inputs.length.toLocaleString('en-US')} buildings · origin ${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`;
  if (store.get().showTrees && treeCount) {
    const total = treeCount.mapped + treeCount.filled;
    text += ` · ${total.toLocaleString('en-US')} trees (${treeCount.mapped.toLocaleString('en-US')} mapped)`;
    if (treeCount.truncated) text += ', capped';
  }
  areaInfo.textContent = text;
}

/** Shows or hides trees; placed in the data worker once per origin and clip, then kept. */
async function updateTrees(): Promise<void> {
  if (!build || !store.get().showTrees) {
    if (treesKey) scene.setTrees(null);
    treesKey = '';
    showAreaInfo();
    return;
  }
  const origin = build.result.origin;
  const key = JSON.stringify([origin, clip]);
  if (key === treesKey) return;
  treesKey = key;
  try {
    const out = await data.trees(origin, clip);
    if (!out || treesKey !== key) return; // superseded, or switched off meanwhile
    scene.setTrees(out.trees.points);
    treeCount = { mapped: out.trees.mapped, filled: out.trees.filled, truncated: out.trees.truncated };
    showAreaInfo();
  } catch (e) {
    treesKey = '';
    controls.setStatus(`Trees failed: ${errorText(e)}`, 'error');
  }
}

function overlayContext(): OverlayContext | null {
  if (!build || !resolved || !generation) return null;
  return {
    meta: build.result.meta,
    inputs: build.result.inputs,
    resolved,
    debug: generation.debug,
    groupSizes,
  };
}

function colourOf(index: number): ReturnType<typeof colourFor> {
  const mode = store.get().colourBy;
  if (mode === 'none') return null;
  // Type and era need resolved specs; until the background fill is done, keep generated colours.
  if (needsResolve(mode) && !resolved?.complete()) return null;
  const ctx = overlayContext();
  return ctx ? colourFor(mode, index, ctx) : null;
}

function repaintAll(): void {
  for (const view of scene.tiles().values()) {
    if (generation && view.generation === generation.id) paintTile(view, colourOf, selected);
  }
}

function ensureResolved(): void {
  if (resolved && needsResolve(store.get().colourBy) && !resolved.complete()) resolved.fill(repaintAll);
}

function updatePassages(): void {
  if (!build || !store.get().showPassages) {
    layers.setPassages(null);
    return;
  }
  const lines: { line: readonly Vec2[]; width: number }[] = [];
  for (const r of build.result.roads) if (r.passage) lines.push({ line: r.line, width: r.width });
  // Per-building pieces carry the flag too (the adapter clips roads per building).
  for (const input of build.result.inputs) {
    for (const r of input.roads ?? []) if (r.passage) lines.push({ line: r.line, width: r.width ?? 3 });
  }
  layers.setPassages(lines);
}

function topOf(view: TileView, k: number): number {
  const range = view.ranges[k];
  if (!range) return 0;
  const positions = view.mesh.geometry.getAttribute('position').array as Float32Array;
  let top = 0;
  for (let v = range.vertexStart; v < range.vertexStart + range.vertexCount; v++) {
    top = Math.max(top, positions[v * 3 + 1] as number);
  }
  return top;
}

function showSelection(): void {
  if (!build || selected === null) {
    inspector.show(null);
    layers.setSelection(null, false);
    return;
  }
  const index = selected;
  const input = build.result.inputs[index];
  const meta = build.result.meta[index];
  if (!input || !meta) return;
  const at = located.get(index);
  const level = at?.view.level ?? (store.get().detail === 'massing' ? 'massing' : 'full');
  layers.setSelection(
    {
      footprint: input.footprint,
      top: at ? topOf(at.view, at.k) : (input.height ?? 10),
      neighbours: input.neighbours ?? [],
    },
    store.get().showNeighbours,
  );
  const offset: Vec2 = [Math.round(meta.centroid[0]), Math.round(meta.centroid[1])];
  inspector.show({
    index,
    meta,
    input,
    poolError: generation?.errors.get(index),
    inspection: inspectBuilding(input, level),
    level,
    groupSize: groupSizes.get(meta.groupKey) ?? 1,
    studioLink: studioLink(store.get().studioUrl, input, offset),
  });
}

function select(index: number | null): void {
  const previous = selected;
  selected = index;
  for (const b of [previous, index]) {
    if (b === null) continue;
    const at = located.get(b);
    if (at) paintBuilding(at.view, at.k, colourOf(b), b === selected);
  }
  showSelection();
}

function focusBuilding(index: number): void {
  const meta = build?.result.meta[index];
  if (meta) scene.focus(meta.centroid, Math.sqrt(meta.area));
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

const controls = createControls(byId('controls'), store, {
  loadSample: () => void load({ kind: 'url', url: sampleUrl, name: 'ulm-minster.osm' }, undefined),
  loadFile: (file) => void load({ kind: 'blob', blob: file, name: file.name }, undefined),
  loadOverpass() {
    const s = store.get();
    const area = s.areaMode === 'bbox' ? parseBBox(s.bboxText) : parseCentre(s.centreText, s.radius);
    if ('error' in area) {
      controls.setStatus(area.error, 'error');
      return;
    }
    void load({ kind: 'overpass', bbox: area.bbox, endpoint: s.endpoint.trim() }, area.bbox);
  },
  loadTiles(apiKey) {
    const s = store.get();
    const area = s.areaMode === 'bbox' ? parseBBox(s.bboxText) : parseCentre(s.centreText, s.radius);
    if ('error' in area) {
      controls.setStatus(area.error, 'error');
      return;
    }
    const url = s.tileSource.trim();
    if (!/^https?:\/\//.test(url)) {
      controls.setStatus('Enter a TileJSON URL or a tile URL template with {z}/{x}/{y}.', 'error');
      return;
    }
    void load({ kind: 'tiles', bbox: area.bbox, url, apiKey: apiKey.trim(), zoom: s.tileZoom }, area.bbox);
  },
  cancelLoad: () => data.cancelLoad(),
  retry() {
    if (lastLoad) void load(lastLoad.source, lastLoad.clip);
  },
  fit() {
    if (build) scene.fit(extentOf(build.result.meta));
  },
});

const inspector = createInspector(byId('inspector'), {
  copy(text, what) {
    copyText(text).then(
      () => toast(`${what} copied`),
      (e: unknown) => toast(`Copy failed: ${errorText(e)}`),
    );
  },
  focus: focusBuilding,
  close: () => select(null),
});

const stats = createStats(byId('stats'), {
  select(index) {
    select(index);
    focusBuilding(index);
  },
  profile() {
    if (!build || profile) return;
    const inputs = build.result.inputs;
    profileProgress = { done: 0, total: inputs.length };
    const run = runProfile(inputs, (done, total) => {
      profileProgress = { done, total };
    });
    profile = run;
    void run.promise.then((entries) => {
      if (profile !== run) return;
      profile = null;
      profileProgress = null;
      if (entries) profileResult = entries;
    });
  },
  cancelProfile() {
    profile?.cancel();
    profile = null;
    profileProgress = null;
  },
});

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
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

function worstBuildings(): StatsData['worst'] {
  if (!build) return null;
  const meta: readonly AreaMeta[] = build.result.meta;
  let list: BuildingTime[] = [];
  let source = '';
  if (profileResult) {
    source = 'Profile run: main thread, one generateBuilding call each.';
    list = profileResult.map((e) => ({
      index: e.index,
      label: metaLabel(meta[e.index] as AreaMeta),
      ms: e.ms,
      triangles: e.triangles,
    }));
  } else if (generation) {
    const g = generation;
    source = 'Worker debug timings (sum of stages).';
    g.debug.forEach((d, index) => {
      if (d)
        list.push({
          index,
          label: metaLabel(meta[index] as AreaMeta),
          ms: d.ms,
          triangles: g.triangles[index] ?? 0,
        });
    });
  }
  if (list.length === 0) return null;
  list.sort((a, b) => b.ms - a.ms);
  return { source, list: list.slice(0, 10) };
}

function collectStats(): StatsData {
  const meta: readonly AreaMeta[] = build?.result.meta ?? [];
  return {
    poolSize: POOL_SIZE,
    load: summary,
    buildMs: build?.ms ?? null,
    buildWallMs: build?.wallMs ?? null,
    skipped: build ? skippedText(build.result) : null,
    buildings: build?.result.inputs.length ?? 0,
    roads: build?.result.roads.length ?? 0,
    generation: generation?.stats() ?? null,
    worst: worstBuildings(),
    failures: generation
      ? [...generation.errors].slice(0, 200).map(([index, message]) => ({
          index,
          label: meta[index] ? metaLabel(meta[index]) : String(index),
          message,
        }))
      : [],
    profile: profileProgress,
  };
}

setInterval(() => stats.update(collectStats(), scene.renderStats()), 500);

// ---------------------------------------------------------------------------
// Reacting to settings
// ---------------------------------------------------------------------------

let saveTimer = 0;
let rebuildTimer = 0;
store.subscribe((next, prev) => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveSettings(store.get()), 300);

  if (changed(next, prev, ['region', 'modernity', 'seed', 'shopProbability'])) {
    // Sliders fire continuously; the data worker also collapses queued builds.
    clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => void rebuild(), 150);
  }
  if (next.tileSize !== prev.tileSize) startTiles(true, selected);
  if (
    changed(next, prev, ['detail', 'autoRadius', 'debugGeneration']) ||
    needsDebug(next) !== needsDebug(prev)
  ) {
    generation?.update(detailOptions());
  }
  if (next.colourBy !== prev.colourBy) {
    ensureResolved();
    repaintAll();
  }
  if (next.showPassages !== prev.showPassages) updatePassages();
  if (next.showNeighbours !== prev.showNeighbours || next.studioUrl !== prev.studioUrl) showSelection();
  if (next.shadows !== prev.shadows) scene.setShadows(next.shadows);
  if (next.fog !== prev.fog) scene.setFog(next.fog);
  if (next.showTrees !== prev.showTrees) void updateTrees();
  if (next.theme !== prev.theme) {
    applyThemeAttribute();
    scene.applyTheme();
  }
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (store.get().theme === 'auto') scene.applyTheme();
});

scene.onCameraIdle(() => {
  if (store.get().detail === 'auto') generation?.update(detailOptions());
});

attachPicking(
  scene,
  () => generation?.id ?? -1,
  (hit) => select(hit ? hit.building : null),
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected !== null) select(null);
});

// Drag and drop onto the map.
let dragDepth = 0;
viewEl.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  viewEl.classList.add('dragging');
});
viewEl.addEventListener('dragover', (e) => e.preventDefault());
viewEl.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) viewEl.classList.remove('dragging');
});
viewEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  viewEl.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void load({ kind: 'blob', blob: file, name: file.name }, undefined);
});

// `?sample` in the URL loads the bundled extract right away (handy for testing and demos).
if (new URLSearchParams(window.location.search).has('sample')) {
  void load({ kind: 'url', url: sampleUrl, name: 'ulm-minster.osm' }, undefined);
}

// For headless measurements: read the latest stats from the console / DevTools protocol.
(window as unknown as { viewerStats: () => StatsData }).viewerStats = collectStats;
