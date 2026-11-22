/**
 * Studio entry point: creates the stores, wires the panels together and owns the
 * generate loop (one generateBuilding call per animation frame at most).
 */
import {
  type BuildingInput,
  BuildingInputError,
  type BuildingMesh,
  generateBuilding,
} from '@osm-buildingen/core';
import { byId, h } from './dom';
import { createInspector } from './inspector';
import { createOsmDialog } from './osm-dialog';
import { createParams } from './params';
import { createPlanEditor } from './plan-editor';
import { PRESETS, applyGeometry, defaultInput, randomFootprint, randomSeed } from './presets';
import {
  copyText,
  decodePermalinkHash,
  downloadBlob,
  encodePermalinkHash,
  filenameFor,
  inputToJson,
  loadStoredInput,
  parseJsonInput,
  storeInput,
  testCaseSnippet,
} from './share';
import {
  type CentreLayout,
  DEFAULT_UI,
  EMPTY_GENERATION,
  type GenerationState,
  type InputSource,
  type StudioState,
  createStore,
} from './state';
import './style.css';
import { createView3d } from './view3d';

// ---------------------------------------------------------------------------
// Banner and toast
// ---------------------------------------------------------------------------

const banner = byId<HTMLDivElement>('banner');
const toastEl = byId<HTMLDivElement>('toast');
let toastTimer = 0;

function showBanner(message: string | null): void {
  banner.hidden = message === null;
  banner.textContent = message ?? '';
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('visible'), 2200);
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Startup: permalink hash > localStorage > default
// ---------------------------------------------------------------------------

async function initialInput(): Promise<BuildingInput> {
  try {
    const fromHash = await decodePermalinkHash(window.location.hash);
    if (fromHash) {
      // Drop the hash so a reload after editing restores the edits, not the link.
      history.replaceState(null, '', window.location.pathname + window.location.search);
      // Store it now: with the hash gone, a reload before the first edit would bring back the old input.
      storeInput(fromHash);
      return fromHash;
    }
  } catch (e) {
    showBanner(`Could not read the permalink: ${errorText(e)}`);
  }
  return loadStoredInput() ?? defaultInput();
}

async function main(): Promise<void> {
  const store = createStore<StudioState>({ input: await initialInput(), ui: DEFAULT_UI });
  const generation = createStore<GenerationState>(EMPTY_GENERATION);

  const view = createView3d(byId('view3d'));
  const plan = createPlanEditor(byId('plan'), store, generation);
  createParams(byId('params'), store, generation);
  createInspector(byId('inspector'), generation);

  // --- generate loop ---

  let scheduled = 0;
  const schedule = (): void => {
    if (!scheduled) scheduled = requestAnimationFrame(generate);
  };
  function generate(): void {
    scheduled = 0;
    const input = store.get().input;
    const t0 = performance.now();
    try {
      const mesh = generateBuilding({ ...input, debug: true });
      generation.set({ mesh, meshInput: input, error: null, elapsed: performance.now() - t0 });
      showBanner(null);
    } catch (e) {
      // Keep the last good mesh on screen; only the banner changes.
      const prefix = e instanceof BuildingInputError ? 'Invalid input' : 'Generator error';
      if (!(e instanceof BuildingInputError)) console.error(e);
      generation.update((g) => ({ ...g, error: `${prefix}: ${errorText(e)}` }));
      showBanner(`${prefix}: ${errorText(e)} — showing the last good mesh.`);
    }
  }

  // --- neighbours as grey massing blocks in 3D ---

  let lastNeighbours: BuildingInput['neighbours'] | null = null;
  function updateContext(): void {
    const { input, ui } = store.get();
    const neighbours = ui.showContext ? input.neighbours : undefined;
    if (neighbours === lastNeighbours) return;
    lastNeighbours = neighbours;
    const meshes: BuildingMesh[] = [];
    (neighbours ?? []).forEach((n, i) => {
      try {
        meshes.push(
          generateBuilding({
            footprint: n.footprint,
            height: n.height ?? 6,
            ...(n.minHeight !== undefined && n.minHeight < (n.height ?? 6) ? { minHeight: n.minHeight } : {}),
            roof: { shape: 'flat' },
            detail: 'massing',
            style: input.style,
            seed: `context-${i}`,
            baseElevation: input.baseElevation,
          }),
        );
      } catch {
        // A half-drawn neighbour may be degenerate; just leave it out of the 3D view.
      }
    });
    view.setContext(meshes);
  }

  // --- persistence (debounced: dragging a vertex updates the input every frame) ---

  let saveTimer = 0;
  const save = (): void => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => storeInput(store.get().input), 300);
  };

  store.subscribe((next, prev) => {
    if (next.input !== prev.input) {
      schedule();
      save();
    }
    if (next.input !== prev.input || next.ui.showContext !== prev.ui.showContext) updateContext();
    if (next.ui.source !== prev.ui.source) renderSourceChip(next.ui.source);
    // The chip names where the outline came from; once the outline is edited it no longer does.
    if (
      next.ui.source &&
      next.ui.source === prev.ui.source &&
      next.input.footprint !== prev.input.footprint
    ) {
      queueMicrotask(() => store.update((s) => ({ ...s, ui: { ...s.ui, source: null } })));
    }
    if (next.ui.wireframe !== prev.ui.wireframe) view.setWireframe(next.ui.wireframe);
    if (next.ui.layout !== prev.ui.layout) applyLayout(next.ui.layout);
  });
  generation.subscribe((next, prev) => {
    if (next.mesh !== prev.mesh) view.setMesh(next.mesh);
  });

  // --- toolbar ---

  const loadInput = (input: BuildingInput, fit = true, source: InputSource | null = null): void => {
    store.update((s) => ({ input, ui: { ...s.ui, selection: null, tool: 'select', source } }));
    if (fit) {
      requestAnimationFrame(() => {
        plan.fit();
        view.fit();
      });
    }
  };
  const loadGeometry = (g: ReturnType<typeof randomFootprint>): void =>
    loadInput(applyGeometry(store.get().input, g));

  const presetSelect = h(
    'select',
    { title: 'Replace footprint, neighbours and roads with a preset' },
    h('option', { attrs: { value: '' } }, 'Preset…'),
    ...PRESETS.map((p) => h('option', { attrs: { value: p.id } }, p.label)),
  );
  presetSelect.addEventListener('change', () => {
    const preset = PRESETS.find((p) => p.id === presetSelect.value);
    presetSelect.value = '';
    if (preset) loadGeometry(preset.make());
  });

  const randomButton = h(
    'button',
    {
      title: 'New seeded random rectilinear footprint',
      on: {
        click: () => {
          const seed = randomSeed();
          loadGeometry(randomFootprint(seed));
          toast(`Footprint seed ${seed}`);
        },
      },
    },
    'Random footprint',
  );

  const osmDialog = createOsmDialog({
    getStyle: () => store.get().input.style,
    onLoad: (input, source) => {
      loadInput(input, true, source);
      toast(`Loaded ${source.label}`);
    },
  });
  const osmButton = h(
    'button',
    { title: 'Import a building from OpenStreetMap', on: { click: () => osmDialog.open() } },
    'From OSM…',
  );
  const sourceChip = h('a', {
    class: 'source-chip',
    attrs: { target: '_blank', rel: 'noopener', hidden: true },
  });
  function renderSourceChip(source: InputSource | null): void {
    sourceChip.hidden = source === null;
    if (!source) return;
    sourceChip.href = source.url;
    sourceChip.textContent = `from ${source.osmType} ${source.osmId}${source.ring ? ` #${source.ring}` : ''} ↗`;
    sourceChip.title = `${source.label} — open on openstreetmap.org`;
  }

  const layoutButtons = (['split', '3d', 'plan'] as const).map((layout) =>
    h(
      'button',
      {
        class: 'seg',
        attrs: { 'data-layout': layout },
        on: { click: () => store.update((s) => ({ ...s, ui: { ...s.ui, layout } })) },
      },
      layout === 'split' ? 'Split' : layout === '3d' ? '3D' : 'Plan',
    ),
  );

  const toggle = (label: string, key: 'wireframe' | 'showContext', title: string): HTMLElement => {
    const box = h('input', { attrs: { type: 'checkbox', checked: store.get().ui[key] } });
    box.addEventListener('change', () =>
      store.update((s) => ({ ...s, ui: { ...s.ui, [key]: box.checked } })),
    );
    return h('label', { class: 'check', title }, box, ` ${label}`);
  };

  const copy = (text: string, what: string): void => {
    copyText(text).then(
      () => toast(`${what} copied`),
      (e) => showBanner(`Copy failed: ${errorText(e)}`),
    );
  };

  const actions = {
    copyJson: () => copy(inputToJson(store.get().input), 'Input JSON'),
    loadJson: () => openLoadDialog(),
    permalink: async () => {
      const hash = await encodePermalinkHash(store.get().input);
      const url = `${window.location.origin}${window.location.pathname}${hash}`;
      copy(url, 'Permalink');
    },
    gltf: async () => {
      try {
        const glb = await view.exportGlb();
        downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), filenameFor(store.get().input, 'glb'));
      } catch (e) {
        showBanner(`glTF export failed: ${errorText(e)}`);
      }
    },
    testCase: () => copy(testCaseSnippet(store.get().input), 'Test case'),
  };

  byId('toolbar').append(
    h('strong', { class: 'brand' }, 'Studio'),
    presetSelect,
    randomButton,
    osmButton,
    sourceChip,
    h('span', { class: 'sep' }),
    h('span', { class: 'segmented' }, ...layoutButtons),
    h('button', { title: 'Frame the building in 3D', on: { click: () => view.fit() } }, 'Fit 3D'),
    toggle('wireframe', 'wireframe', 'Show the building as wireframe'),
    toggle('context', 'showContext', 'Show neighbours as grey blocks in 3D'),
    h('span', { class: 'spacer' }),
    h('button', { title: 'Copy the input as JSON', on: { click: actions.copyJson } }, 'Copy JSON'),
    h('button', { title: 'Paste an input JSON', on: { click: actions.loadJson } }, 'Load JSON'),
    h(
      'button',
      { title: 'Copy a link with the input in the URL', on: { click: () => void actions.permalink() } },
      'Permalink',
    ),
    h(
      'button',
      { title: 'Download the mesh as binary glTF', on: { click: () => void actions.gltf() } },
      'glTF',
    ),
    h(
      'button',
      { title: 'Copy a generateBuilding({...}) snippet for tests', on: { click: actions.testCase } },
      'Test case',
    ),
  );

  function applyLayout(layout: CentreLayout): void {
    byId('centre').dataset.layout = layout;
    for (const b of layoutButtons) b.classList.toggle('active', b.dataset.layout === layout);
  }
  applyLayout(store.get().ui.layout);

  // --- load dialog ---

  const dialog = byId<HTMLDialogElement>('load-dialog');
  const area = byId<HTMLTextAreaElement>('load-text');
  const dialogError = byId<HTMLParagraphElement>('load-error');
  function openLoadDialog(): void {
    area.value = '';
    dialogError.textContent = '';
    dialog.showModal();
    area.focus();
  }
  byId('load-cancel').addEventListener('click', () => dialog.close());
  byId('load-ok').addEventListener('click', () => {
    try {
      loadInput(parseJsonInput(area.value));
      dialog.close();
    } catch (e) {
      dialogError.textContent = errorText(e);
    }
  });

  updateContext();
  generate();
}

main().catch((e: unknown) => {
  console.error(e);
  showBanner(`Studio failed to start: ${errorText(e)}`);
});
