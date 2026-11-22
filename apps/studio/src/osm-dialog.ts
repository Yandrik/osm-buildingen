/**
 * "From OSM…" dialog: get OSM data (file, Overpass location, bundled sample), pick a
 * building on the map, load its input into the studio. Data logic lives in
 * `osm-import.ts`, the map in `osm-picker.ts`. The loaded area stays in memory for the
 * session so reopening the dialog is instant; the source settings go to localStorage.
 */
import type { BuildingInput, StyleInput } from '@osm-buildingen/core';
import sampleUrl from '../../../packages/osm/test/fixtures/ulm-minster.osm?url';
import { clear, fmt, h } from './dom';
import {
  type BuildingMeta,
  DEFAULT_OVERPASS_ENDPOINT,
  DEFAULT_RADIUS,
  MAX_RADIUS,
  type OsmArea,
  OverpassError,
  SUMMARY_TAGS,
  addressOf,
  areaFromText,
  buildingLabel,
  clampRadius,
  fetchArea,
  groupMembers,
  inputForBuilding,
  parseLocation,
  searchBuildings,
  sourceOf,
} from './osm-import';
import { TYPE_COLOURS, createPickerMap, typeKey } from './osm-picker';
import type { InputSource } from './state';

export interface OsmDialog {
  open(): void;
}

export interface OsmDialogOptions {
  /** The studio's current style; the imported input uses it. */
  getStyle(): StyleInput;
  onLoad(input: BuildingInput, source: InputSource): void;
}

type Tab = 'file' | 'location' | 'sample';

interface Settings {
  tab: Tab;
  place: string;
  radius: number;
  endpoint: string;
}

const SETTINGS_KEY = 'osm-buildingen.studio.osm-source';
const DEFAULT_SETTINGS: Settings = {
  tab: 'sample',
  place: '48.39840, 9.99250',
  radius: DEFAULT_RADIUS,
  endpoint: DEFAULT_OVERPASS_ENDPOINT,
};

function loadSettings(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
    const r = raw as Partial<Record<keyof Settings, unknown>>;
    return {
      tab: r.tab === 'file' || r.tab === 'location' || r.tab === 'sample' ? r.tab : DEFAULT_SETTINGS.tab,
      place: typeof r.place === 'string' ? r.place : DEFAULT_SETTINGS.place,
      radius: typeof r.radius === 'number' ? clampRadius(r.radius) : DEFAULT_SETTINGS.radius,
      endpoint: typeof r.endpoint === 'string' && r.endpoint ? r.endpoint : DEFAULT_SETTINGS.endpoint,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Remembering the last source is a convenience only.
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createOsmDialog(options: OsmDialogOptions): OsmDialog {
  const settings = loadSettings();
  let area: OsmArea | null = null;
  let selected: number | null = null;
  let busy: AbortController | null = null;
  let lastAction: (() => void) | null = null;

  // --- source panels ---

  const tabButtons = (['file', 'location', 'sample'] as const).map((tab) =>
    h(
      'button',
      { class: 'seg', attrs: { type: 'button', 'data-tab': tab }, on: { click: () => setTab(tab) } },
      tab === 'file' ? 'File' : tab === 'location' ? 'Location' : 'Sample',
    ),
  );

  const fileInput = h('input', { attrs: { type: 'file', accept: '.osm,.xml,.json,application/json' } });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readFile(file);
    fileInput.value = '';
  });
  const drop = h(
    'label',
    { class: 'osm-drop' },
    h('strong', {}, 'Drop an .osm or Overpass .json file'),
    h('span', { class: 'muted' }, 'or click to choose one'),
    fileInput,
  );
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer?.files[0];
    if (file) readFile(file);
  });
  const filePanel = h(
    'div',
    { class: 'osm-panel' },
    drop,
    h(
      'p',
      { class: 'muted small' },
      'Export from openstreetmap.org (Export → Manual), JOSM, or Overpass with [out:json] / [out:xml].',
    ),
  );

  const placeInput = h('input', {
    attrs: {
      type: 'text',
      value: settings.place,
      placeholder: '48.3984, 9.9925 · osm.org URL · way/25697720',
      spellcheck: 'false',
    },
  });
  const placeHint = h('div', { class: 'muted small osm-place-hint' });
  const radiusInput = h('input', {
    attrs: { type: 'number', min: 10, max: MAX_RADIUS, step: 10, value: settings.radius },
  });
  const endpointInput = h('input', {
    attrs: { type: 'text', value: settings.endpoint, spellcheck: 'false' },
  });
  const fetchButton = h(
    'button',
    { class: 'primary', attrs: { type: 'button' }, on: { click: () => fetchLocation() } },
    'Fetch',
  );
  const updatePlaceHint = (): void => {
    const q = parseLocation(placeInput.value);
    placeHint.textContent = !q
      ? 'Enter "lat, lon", an openstreetmap.org link or way/relation id.'
      : q.kind === 'point'
        ? `→ lat ${q.lat.toFixed(5)}, lon ${q.lon.toFixed(5)}`
        : `→ ${q.osmType} ${q.id} (located first, then its surroundings)`;
    placeHint.classList.toggle('error', !q && placeInput.value.trim() !== '');
    fetchButton.disabled = !q || busy !== null;
  };
  placeInput.addEventListener('input', updatePlaceHint);
  placeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchLocation();
  });
  const locationPanel = h(
    'div',
    { class: 'osm-panel' },
    h('label', { class: 'field' }, h('span', {}, 'Location'), placeInput),
    placeHint,
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Radius'),
      h('span', { class: 'inline' }, radiusInput, h('span', { class: 'muted' }, ` m (max ${MAX_RADIUS})`)),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, 'Endpoint'),
      h(
        'span',
        { class: 'inline' },
        endpointInput,
        h(
          'button',
          {
            title: 'Use the public default endpoint',
            attrs: { type: 'button' },
            on: { click: () => (endpointInput.value = DEFAULT_OVERPASS_ENDPOINT) },
          },
          '↺',
        ),
      ),
    ),
    h('div', { class: 'buttons' }, fetchButton),
    h(
      'p',
      { class: 'muted small' },
      'Data © OpenStreetMap contributors (ODbL). The public Overpass server is shared; please keep areas small.',
    ),
  );

  const samplePanel = h(
    'div',
    { class: 'osm-panel' },
    h('p', {}, 'Ulm, around the Minster: about 600 buildings, the city library, the Stadthaus, dense rows.'),
    h(
      'div',
      { class: 'buttons' },
      h(
        'button',
        { class: 'primary', attrs: { type: 'button' }, on: { click: () => loadSample() } },
        'Load sample',
      ),
    ),
    h('p', { class: 'muted small' }, '© OpenStreetMap contributors, ODbL.'),
  );
  const panels: Record<Tab, HTMLElement> = { file: filePanel, location: locationPanel, sample: samplePanel };

  const statusText = h('span', {});
  const retryButton = h(
    'button',
    { attrs: { type: 'button', hidden: true }, on: { click: () => lastAction?.() } },
    'Retry',
  );
  const cancelFetch = h(
    'button',
    { attrs: { type: 'button', hidden: true }, on: { click: () => busy?.abort() } },
    'Cancel',
  );
  const status = h(
    'div',
    { class: 'osm-status', attrs: { role: 'status' } },
    statusText,
    retryButton,
    cancelFetch,
  );

  // --- search and list ---

  const searchInput = h('input', {
    attrs: { type: 'search', placeholder: 'Search name, address or OSM id', spellcheck: 'false' },
  });
  const listCount = h('div', { class: 'muted small' });
  const list = h('ul', { class: 'osm-list' });
  searchInput.addEventListener('input', () => updateList());
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector<HTMLLIElement>('li[data-index]');
      if (first) select(Number(first.dataset.index), true);
    }
  });

  // --- map and summary ---

  const mapEl = h('div', { class: 'osm-map' });
  const picker = createPickerMap(mapEl, {
    onSelect: (i) => select(i, false),
    onActivate: (i) => {
      select(i, false);
      load();
    },
  });
  const legend = h(
    'div',
    { class: 'osm-legend' },
    ...Object.entries(TYPE_COLOURS).map(([type, colour]) =>
      h('span', {}, h('i', { style: { background: colour } }), type),
    ),
    h('span', {}, h('i', { class: 'hatched' }), 'special'),
  );

  const summary = h('div', { class: 'osm-summary-body' });
  const groupBox = h('input', { attrs: { type: 'checkbox', checked: true } });
  const loadButton = h(
    'button',
    { class: 'primary', attrs: { type: 'button', disabled: true }, on: { click: () => load() } },
    'Load into studio',
  );

  const areaLabel = h('span', { class: 'muted osm-area-label' });
  const dialog = h(
    'dialog',
    { class: 'osm-dialog' },
    h(
      'header',
      {},
      h('h3', {}, 'From OSM'),
      areaLabel,
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'close',
          title: 'Close (Esc)',
          attrs: { type: 'button' },
          on: { click: () => dialog.close() },
        },
        '×',
      ),
    ),
    h(
      'div',
      { class: 'osm-body' },
      h(
        'aside',
        { class: 'osm-side' },
        h('span', { class: 'segmented' }, ...tabButtons),
        filePanel,
        locationPanel,
        samplePanel,
        status,
        h('div', { class: 'osm-search' }, searchInput, listCount),
        list,
      ),
      h('div', { class: 'osm-centre' }, mapEl, legend),
      h(
        'aside',
        { class: 'osm-summary' },
        summary,
        h(
          'label',
          {
            class: 'check',
            title: 'The adapter passes buildings on the same plot as neighbours with sameGroup',
          },
          groupBox,
          ' include same-plot buildings as neighbours',
        ),
        h(
          'div',
          { class: 'buttons' },
          h('button', { attrs: { type: 'button' }, on: { click: () => dialog.close() } }, 'Cancel'),
          loadButton,
        ),
      ),
    ),
  );
  document.body.append(dialog);

  // --- behaviour ---

  function persist(): void {
    settings.place = placeInput.value;
    settings.radius = clampRadius(Number(radiusInput.value));
    settings.endpoint = endpointInput.value.trim() || DEFAULT_OVERPASS_ENDPOINT;
    saveSettings(settings);
  }

  function setTab(tab: Tab): void {
    settings.tab = tab;
    for (const b of tabButtons) b.classList.toggle('active', b.dataset.tab === tab);
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== tab;
    persist();
  }

  function setStatus(text: string, kind: 'info' | 'error' | 'busy' = 'info', retry = false): void {
    statusText.textContent = text;
    status.dataset.kind = kind;
    retryButton.hidden = !retry;
    cancelFetch.hidden = kind !== 'busy' || busy === null;
  }

  function setBusy(controller: AbortController | null): void {
    busy = controller;
    for (const b of dialog.querySelectorAll<HTMLButtonElement>('.osm-panel button'))
      b.disabled = busy !== null;
    updatePlaceHint();
  }

  function setArea(next: OsmArea): void {
    area = next;
    areaLabel.textContent = `${next.label} · ${next.result.inputs.length} buildings · ${next.result.roads.length} roads`;
    picker.setArea(next.result);
    searchInput.value = '';
    selected = null;
    updateList();
    if (next.focus !== null) select(next.focus, true);
    else renderSummary();
  }

  async function run(
    label: string,
    task: (signal: AbortSignal, setStep: (step: string) => void) => Promise<OsmArea>,
  ): Promise<void> {
    if (busy) return;
    const controller = new AbortController();
    setBusy(controller);
    const t0 = performance.now();
    let step = label;
    const tick = (): void => setStatus(`${step} ${Math.round((performance.now() - t0) / 1000)} s`, 'busy');
    tick();
    const timer = window.setInterval(tick, 500);
    const setStep = (next: string): void => {
      step = next;
      tick();
    };
    try {
      const next = await task(controller.signal, setStep);
      setArea(next);
      setStatus(`Loaded ${next.label}.`);
    } catch (e) {
      if (controller.signal.aborted) setStatus('Cancelled.', 'info', true);
      else if (e instanceof OverpassError && e.retryable) {
        setStatus(
          `Server busy (HTTP ${e.status}), try again in a minute or use another endpoint.`,
          'error',
          true,
        );
      } else setStatus(errorText(e), 'error', e instanceof OverpassError || e instanceof TypeError);
    } finally {
      clearInterval(timer);
      setBusy(null);
      // The Cancel button belongs to the busy state only.
      cancelFetch.hidden = true;
    }
  }

  function readFile(file: File): void {
    lastAction = () => readFile(file);
    void run(`Reading ${file.name}…`, async () => areaFromText(await file.text(), file.name));
  }

  function loadSample(): void {
    lastAction = loadSample;
    void run('Loading sample…', async (signal) => {
      const response = await fetch(sampleUrl, { signal });
      if (!response.ok) throw new Error(`Sample not available (${response.status}).`);
      return areaFromText(await response.text(), 'ulm-minster.osm (sample)');
    });
  }

  function fetchLocation(): void {
    const query = parseLocation(placeInput.value);
    if (!query || busy) return;
    persist();
    radiusInput.value = String(settings.radius);
    lastAction = fetchLocation;
    void run('Contacting Overpass…', (signal, setStep) =>
      fetchArea({ query, radius: settings.radius, endpoint: settings.endpoint, signal, onStep: setStep }),
    );
  }

  function updateList(): void {
    clear(list);
    if (!area) {
      listCount.textContent = '';
      picker.setMatches(null);
      return;
    }
    const q = searchInput.value;
    const found = searchBuildings(area.result, q);
    picker.setMatches(q.trim() ? found : null);
    listCount.textContent = q.trim()
      ? `${found.length}${found.length === 200 ? '+' : ''} matches`
      : `${found.length} named buildings · type to search`;
    for (const i of found) {
      const m = area.result.meta[i] as BuildingMeta;
      const addr = addressOf(m);
      list.append(
        h(
          'li',
          {
            class: i === selected ? 'active' : '',
            attrs: { 'data-index': i },
            on: { click: () => select(i, true) },
          },
          h('i', { class: 'dot', style: { background: TYPE_COLOURS[typeKey(m)] ?? '' } }),
          h(
            'span',
            { class: 'name' },
            buildingLabel(m),
            m.tags.name && addr ? h('span', { class: 'muted' }, ` · ${addr}`) : null,
          ),
          h('span', { class: 'muted small' }, m.type ?? 'auto'),
        ),
      );
    }
  }

  function select(index: number, focus: boolean): void {
    selected = index;
    picker.setSelected(index, focus);
    for (const li of list.querySelectorAll<HTMLLIElement>('li[data-index]')) {
      const on = Number(li.dataset.index) === index;
      li.classList.toggle('active', on);
      if (on && !focus) li.scrollIntoView({ block: 'nearest' });
    }
    renderSummary();
  }

  function renderSummary(): void {
    clear(summary);
    const result = area?.result;
    const m = selected === null ? undefined : result?.meta[selected];
    const input = selected === null ? undefined : result?.inputs[selected];
    loadButton.disabled = !m;
    if (!result || !m || !input || selected === null) {
      summary.append(
        h(
          'p',
          { class: 'muted' },
          area ? 'Click a building on the map or in the list.' : 'No area loaded yet.',
        ),
      );
      return;
    }
    const source = sourceOf(m);
    const neighbours = input.neighbours ?? [];
    const roads = input.roads ?? [];
    const sameGroup = neighbours.filter((n) => n.sameGroup).length;
    const passages = roads.filter((r) => r.passage).length;
    const members = groupMembers(result, selected);
    const row = (k: string, v: string | Node): HTMLElement => h('tr', {}, h('th', {}, k), h('td', {}, v));
    summary.append(
      h('h4', {}, buildingLabel(m)),
      h(
        'a',
        { attrs: { href: source.url, target: '_blank', rel: 'noopener' } },
        `${m.osmType} ${m.osmId}${m.ring ? ` (ring ${m.ring})` : ''} ↗`,
      ),
      h(
        'table',
        { class: 'kv' },
        row('type', `${m.type ?? 'auto (core guesses)'}`),
        row('why', m.typeReason),
        m.special ? row('special', "yes, detail 'massing'") : null,
        row('area', `${fmt(m.area, 0)} m²`),
        row('neighbours', `${neighbours.length}${sameGroup ? ` (${sameGroup} same plot)` : ''}`),
        row('roads', `${roads.length}${passages ? ` (${passages} passage)` : ''}`),
        row('parts', String(input.parts?.length ?? 0)),
        row('group', `${m.groupKey} · ${members.length + 1} building${members.length ? 's' : ''}`),
      ),
    );
    if (members.length) {
      summary.append(
        h('h5', {}, 'Same plot'),
        h(
          'ul',
          { class: 'osm-members' },
          ...members.map((j) => {
            const o = result.meta[j] as BuildingMeta;
            return h(
              'li',
              {},
              h('span', {}, `${buildingLabel(o)} `, h('span', { class: 'muted' }, o.type ?? 'auto')),
              h(
                'button',
                {
                  title: 'Select this group member instead',
                  attrs: { type: 'button' },
                  on: { click: () => select(j, true) },
                },
                'open instead',
              ),
            );
          }),
        ),
      );
    }
    const tags = SUMMARY_TAGS.filter((k) => m.tags[k] !== undefined);
    if (tags.length) {
      summary.append(
        h('h5', {}, 'Tags'),
        h('table', { class: 'kv tags' }, ...tags.map((k) => row(k, m.tags[k] as string))),
      );
    }
  }

  function load(): void {
    const result = area?.result;
    const meta = selected === null ? undefined : result?.meta[selected];
    if (!result || !meta || selected === null) return;
    try {
      const input = inputForBuilding(result, selected, {
        style: options.getStyle(),
        groupNeighbours: groupBox.checked,
      });
      options.onLoad(input, sourceOf(meta));
      dialog.close();
    } catch (e) {
      setStatus(errorText(e), 'error');
    }
  }

  radiusInput.addEventListener('change', persist);
  endpointInput.addEventListener('change', persist);
  placeInput.addEventListener('change', persist);
  setTab(settings.tab);
  updatePlaceHint();
  setStatus('');
  renderSummary();

  return {
    open() {
      dialog.showModal();
      if (area) searchInput.focus();
    },
  };
}
