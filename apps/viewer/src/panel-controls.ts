/**
 * Left panel: loading (sample, file, Overpass), generation settings, overlays and
 * view options. Writes straight into the settings store; main.ts decides what
 * to regenerate.
 */
import { type Child, clear, fmt, h } from './dom';
import { legend } from './overlays';
import { type AreaMode, COLOUR_MODES, type ColourMode, type Settings, type Store } from './state';

export interface ControlActions {
  loadSample(): void;
  loadFile(file: File): void;
  loadOverpass(): void;
  cancelLoad(): void;
  retry(): void;
  fit(): void;
}

export type StatusKind = 'info' | 'busy' | 'error';

export interface ControlsPanel {
  setStatus(message: string, kind: StatusKind, retryable?: boolean): void;
  setLoading(loading: boolean): void;
}

type Keys<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

export function createControls(
  root: HTMLElement,
  store: Store<Settings>,
  actions: ControlActions,
): ControlsPanel {
  const s = (): Settings => store.get();
  const set = (patch: Partial<Settings>): void => store.set(patch);

  // --- small builders -------------------------------------------------------

  const row = (label: string, ...children: Child[]): HTMLElement =>
    h('div', { class: 'row' }, h('label', { title: label }, label), ...children);

  function select<K extends Keys<string>>(key: K, options: readonly [string, string][]): HTMLSelectElement {
    const el = h(
      'select',
      { on: { change: () => set({ [key]: el.value } as Partial<Settings>) } },
      ...options.map(([value, label]) => h('option', { attrs: { value } }, label)),
    );
    el.value = String(s()[key]);
    return el;
  }

  function slider(key: Keys<number>, min: number, max: number, step: number): HTMLElement {
    const value = h('span', { class: 'value' }, fmt(s()[key] as number));
    const el = h('input', {
      attrs: { type: 'range', min, max, step },
      on: {
        input: () => {
          value.textContent = fmt(Number(el.value));
          set({ [key]: Number(el.value) } as Partial<Settings>);
        },
      },
    });
    el.value = String(s()[key]);
    return h('div', { class: 'slider' }, el, value);
  }

  function numberField(key: Keys<number>, min: number, max: number, step: number): HTMLInputElement {
    const el = h('input', {
      attrs: { type: 'number', min, max, step },
      on: {
        change: () => {
          const v = Number(el.value);
          if (Number.isFinite(v) && v >= min && v <= max) set({ [key]: v } as Partial<Settings>);
          else el.value = String(s()[key]);
        },
      },
    });
    el.value = String(s()[key]);
    return el;
  }

  function textField(key: Keys<string>, placeholder: string, onEnter?: () => void): HTMLInputElement {
    const el = h('input', {
      attrs: { type: 'text', placeholder, spellcheck: 'false' },
      on: {
        change: () => set({ [key]: el.value } as Partial<Settings>),
        keydown: (e) => {
          if (e.key === 'Enter' && onEnter) {
            set({ [key]: el.value } as Partial<Settings>);
            onEnter();
          }
        },
      },
    });
    el.value = String(s()[key]);
    return el;
  }

  function check(key: Keys<boolean>, label: string, title?: string): HTMLElement {
    const el = h('input', {
      attrs: { type: 'checkbox' },
      on: { change: () => set({ [key]: el.checked } as Partial<Settings>) },
    });
    el.checked = s()[key] as boolean;
    return h('label', { class: 'check', title }, el, label);
  }

  // --- load -----------------------------------------------------------------

  const fileInput = h('input', {
    attrs: { type: 'file', accept: '.osm,.xml,.json', hidden: true },
    on: {
      change: () => {
        const file = fileInput.files?.[0];
        if (file) actions.loadFile(file);
        fileInput.value = '';
      },
    },
  });
  const sampleButton = h(
    'button',
    {
      class: 'primary',
      on: { click: () => actions.loadSample() },
      title: 'Ulm Minster extract, 618 buildings',
    },
    'Load sample',
  );
  const fileButton = h('button', { on: { click: () => fileInput.click() } }, 'Open file…');

  const areaSegments = (['bbox', 'centre'] as AreaMode[]).map((mode) =>
    h(
      'button',
      {
        class: 'seg',
        on: {
          click: () => {
            set({ areaMode: mode });
            syncArea();
          },
        },
      },
      mode === 'bbox' ? 'Bounding box' : 'Centre + radius',
    ),
  );
  const bboxRow = row(
    'bbox',
    textField('bboxText', 'min lon, min lat, max lon, max lat', () => actions.loadOverpass()),
  );
  bboxRow.title = 'min lon, min lat, max lon, max lat — also accepts bbox=…';
  const centreRow = row(
    'centre',
    textField('centreText', 'lat, lon', () => actions.loadOverpass()),
  );
  const radiusRow = row('radius m', numberField('radius', 10, 5000, 10));
  const syncArea = (): void => {
    const mode = s().areaMode;
    areaSegments.forEach((b, i) => b.classList.toggle('active', (i === 0) === (mode === 'bbox')));
    bboxRow.hidden = mode !== 'bbox';
    centreRow.hidden = mode !== 'centre';
    radiusRow.hidden = mode !== 'centre';
  };
  syncArea();

  const overpassButton = h('button', { on: { click: () => actions.loadOverpass() } }, 'Load from Overpass');
  const cancelButton = h(
    'button',
    { on: { click: () => actions.cancelLoad() }, attrs: { hidden: true } },
    'Cancel',
  );
  const status = h('div', { class: 'status' });

  // --- generation -----------------------------------------------------------

  const shopValue = h('span', { class: 'value' });
  const shopSlider = h('input', {
    attrs: { type: 'range', min: 0, max: 1, step: 0.05 },
    on: { input: () => set({ shopProbability: Number(shopSlider.value) }) },
  });
  const shopReset = h(
    'button',
    {
      class: 'clear',
      title: 'Use the style pack default',
      on: { click: () => set({ shopProbability: null }) },
    },
    '×',
  );
  const syncShop = (): void => {
    const v = s().shopProbability;
    shopSlider.value = String(v ?? 0);
    shopSlider.classList.toggle('auto', v === null);
    shopValue.textContent = v === null ? 'pack' : fmt(v);
    shopReset.classList.toggle('hidden', v === null);
  };
  syncShop();

  const seedField = textField('seed', 'none');
  const reroll = h(
    'button',
    {
      class: 'clear',
      title: 'Random seed',
      on: {
        click: () => {
          seedField.value = Math.floor(Math.random() * 1e6).toString(36);
          set({ seed: seedField.value });
        },
      },
    },
    '⟳',
  );

  const radiusField = row('full within m', numberField('autoRadius', 25, 10000, 25));
  const syncDetail = (): void => {
    radiusField.hidden = s().detail !== 'auto';
  };
  syncDetail();

  // --- overlays ---------------------------------------------------------------

  const legendBox = h('div', { class: 'legend' });
  const colourRadios = COLOUR_MODES.map((m) => {
    const input = h('input', {
      attrs: { type: 'radio', name: 'colour-by', value: m.id },
      on: { change: () => set({ colourBy: m.id }) },
    });
    input.checked = s().colourBy === m.id;
    return h('label', { class: 'check radio' }, input, m.label);
  });
  const syncLegend = (mode: ColourMode): void => {
    clear(legendBox);
    for (const item of legend(mode)) {
      legendBox.appendChild(
        h(
          'span',
          { class: 'swatch-item' },
          h('span', { class: 'swatch', style: { background: `rgb(${item.colour.join(',')})` } }),
          item.label,
        ),
      );
    }
    if (mode === 'notes') {
      legendBox.appendChild(h('div', { class: 'muted' }, 'Generates with debug: true in the workers.'));
    }
  };
  syncLegend(s().colourBy);

  // --- assemble ---------------------------------------------------------------

  root.append(
    h('h3', {}, 'Data'),
    h('div', { class: 'buttons' }, sampleButton, fileButton, fileInput),
    h('div', { class: 'muted hint' }, 'or drop an .osm / Overpass .json file on the map'),
    h('div', { class: 'segmented area-mode' }, ...areaSegments),
    bboxRow,
    centreRow,
    radiusRow,
    row('endpoint', textField('endpoint', 'https://overpass-api.de/api/interpreter')),
    h('div', { class: 'buttons' }, overpassButton, cancelButton),
    status,

    h('h3', {}, 'Generation'),
    row(
      'region',
      select('region', [
        ['de', 'de (Germany)'],
        ['us', 'us (suburban)'],
      ]),
    ),
    row('modernity', slider('modernity', 0, 1, 0.05)),
    row('seed', h('div', { class: 'with-button' }, seedField, reroll)),
    row('store prob.', h('div', { class: 'slider' }, shopSlider, shopValue, shopReset)),
    row('tile size m', numberField('tileSize', 25, 5000, 25)),
    row(
      'detail',
      select('detail', [
        ['full', 'full'],
        ['massing', 'massing'],
        ['auto', 'auto (by distance)'],
      ]),
    ),
    radiusField,
    check(
      'debugGeneration',
      'debug data (notes, per-building timings)',
      'Generate with debug: true in the workers',
    ),

    h('h3', {}, 'Overlays'),
    h('div', { class: 'radios' }, ...colourRadios),
    legendBox,
    check('showPassages', 'roads flagged passage'),
    check('showNeighbours', 'neighbour links of the selection'),

    h('h3', {}, 'View'),
    h('div', { class: 'checks' }, check('shadows', 'shadows'), check('fog', 'fog')),
    row(
      'theme',
      select('theme', [
        ['auto', 'system'],
        ['light', 'light'],
        ['dark', 'dark'],
      ]),
    ),
    row('studio URL', textField('studioUrl', 'http://localhost:5173/')),
    h('div', { class: 'buttons' }, h('button', { on: { click: () => actions.fit() } }, 'Fit view')),
  );

  store.subscribe((next, prev) => {
    if (next.shopProbability !== prev.shopProbability) syncShop();
    if (next.detail !== prev.detail) syncDetail();
    if (next.colourBy !== prev.colourBy) syncLegend(next.colourBy);
  });

  return {
    setStatus(message, kind, retryable = false) {
      clear(status);
      status.className = `status ${kind}`;
      status.append(message);
      if (kind === 'error' && retryable) {
        status.append(' ', h('button', { on: { click: () => actions.retry() } }, 'Retry'));
      }
    },
    setLoading(loading) {
      cancelButton.hidden = !loading;
      overpassButton.disabled = loading;
    },
  };
}
