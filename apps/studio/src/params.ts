/**
 * Parameter panel. Every optional parameter has an "auto" state (undefined in the input)
 * and shows the value the generator resolved, greyed, next to the control.
 */
import {
  BUILDING_TYPES,
  type BuildingInput,
  type ColourInput,
  ROOF_SHAPES,
  type ResolvedSpec,
  type RoofInput,
  parseColour,
} from '@osm-buildingen/core';
import { fmt, h, hex } from './dom';
import { randomSeed } from './presets';
import {
  type GenerationState,
  type Store,
  type StudioState,
  patchColours,
  patchInput,
  patchRoof,
} from './state';

interface Row {
  el: HTMLElement;
  sync(input: BuildingInput, spec: ResolvedSpec | undefined): void;
}

type Get<V> = (input: BuildingInput) => V | undefined;
type Set<V> = (input: BuildingInput, value: V | undefined) => BuildingInput;
type Infer = (spec: ResolvedSpec) => string;

export function createParams(
  container: HTMLElement,
  store: Store<StudioState>,
  generation: Store<GenerationState>,
): void {
  const edit = (fn: (input: BuildingInput) => BuildingInput): void =>
    store.update((s) => ({ ...s, input: fn(s.input) }));

  // --- row builders ---

  function frame(
    label: string,
    control: HTMLElement,
    onClear: (() => void) | null,
  ): {
    el: HTMLElement;
    inferred: HTMLElement;
    clearBtn: HTMLButtonElement | null;
  } {
    const inferred = h('span', { class: 'inferred' });
    const clearBtn = onClear
      ? h('button', { class: 'clear', title: 'Back to auto', on: { click: onClear } }, '×')
      : null;
    const el = h('div', { class: 'row' }, h('label', {}, label), control, inferred, clearBtn ?? h('span'));
    return { el, inferred, clearBtn };
  }

  const isFocused = (el: Element): boolean => document.activeElement === el;

  function numberRow(
    label: string,
    get: Get<number>,
    set: Set<number>,
    infer: Infer | null,
    opts: { step?: number; min?: number; max?: number } = {},
  ): Row {
    const input = h('input', {
      attrs: { type: 'number', step: opts.step ?? 1, min: opts.min, max: opts.max, placeholder: 'auto' },
    });
    input.addEventListener('input', () => {
      const v = input.value === '' ? undefined : Number(input.value);
      if (v === undefined || Number.isFinite(v)) edit((i) => set(i, v));
    });
    const f = frame(label, input, () => edit((i) => set(i, undefined)));
    return {
      el: f.el,
      sync(i, spec) {
        const v = get(i);
        if (!isFocused(input)) input.value = v === undefined ? '' : String(v);
        f.inferred.textContent = spec && infer ? infer(spec) : '';
        f.clearBtn?.classList.toggle('hidden', v === undefined);
      },
    };
  }

  function selectRow<V extends string>(
    label: string,
    options: readonly V[],
    get: Get<V>,
    set: Set<V>,
    infer: Infer | null,
    auto = true,
  ): Row {
    const select = h(
      'select',
      {},
      auto ? h('option', { attrs: { value: '' } }, 'auto') : null,
      ...options.map((o) => h('option', { attrs: { value: o } }, o)),
    );
    select.addEventListener('change', () =>
      edit((i) => set(i, select.value === '' ? undefined : (select.value as V))),
    );
    const f = frame(label, select, null);
    return {
      el: f.el,
      sync(i, spec) {
        if (!isFocused(select)) select.value = get(i) ?? '';
        f.inferred.textContent = spec && infer ? infer(spec) : '';
      },
    };
  }

  /** Optional boolean as a three-state select. */
  function boolRow(label: string, get: Get<boolean>, set: Set<boolean>, infer: Infer | null): Row {
    const toText = (b: boolean | undefined): 'yes' | 'no' | undefined =>
      b === undefined ? undefined : b ? 'yes' : 'no';
    return selectRow(
      label,
      ['yes', 'no'] as const,
      (i) => toText(get(i)),
      (i, v) => set(i, v === undefined ? undefined : v === 'yes'),
      infer,
    );
  }

  function colourRow(label: string, key: keyof ColourInput, infer: (spec: ResolvedSpec) => number): Row {
    const input = h('input', { attrs: { type: 'color' } });
    input.addEventListener('input', () => edit((i) => patchColours(i, { [key]: input.value })));
    const f = frame(label, input, () => edit((i) => patchColours(i, { [key]: undefined })));
    return {
      el: f.el,
      sync(i, spec) {
        const explicit = i.colours?.[key];
        const parsed = parseColour(explicit);
        const shown = parsed !== null ? hex(parsed) : spec ? hex(infer(spec)) : '#808080';
        if (!isFocused(input)) input.value = shown;
        input.classList.toggle('auto', explicit === undefined);
        f.inferred.textContent = spec ? hex(infer(spec)) : '';
        f.clearBtn?.classList.toggle('hidden', explicit === undefined);
      },
    };
  }

  function textRow(label: string, get: Get<string>, set: Set<string>): Row {
    const input = h('input', { attrs: { type: 'text', placeholder: 'auto' } });
    input.addEventListener('input', () => edit((i) => set(i, input.value === '' ? undefined : input.value)));
    const f = frame(label, input, () => edit((i) => set(i, undefined)));
    return {
      el: f.el,
      sync(i) {
        const v = get(i);
        if (!isFocused(input)) input.value = v ?? '';
        f.clearBtn?.classList.toggle('hidden', v === undefined);
      },
    };
  }

  // --- the parameters ---

  const roof = (i: BuildingInput): RoofInput => i.roof ?? {};
  const roofRow = <K extends keyof RoofInput>(key: K) => ({
    get: (i: BuildingInput) => roof(i)[key],
    set: (i: BuildingInput, v: RoofInput[K] | undefined) => patchRoof(i, { [key]: v }),
  });
  const field = <K extends keyof BuildingInput>(key: K) => ({
    get: (i: BuildingInput) => i[key],
    set: (i: BuildingInput, v: BuildingInput[K] | undefined) => patchInput(i, { [key]: v }),
  });
  const m = (v: number): string => `${fmt(v)} m`;
  const totalHeight = (s: ResolvedSpec): number => s.base + s.wallHeight + s.roof.height;

  const typeF = field('type');
  const levelsF = field('levels');
  const heightF = field('height');
  const minHeightF = field('minHeight');
  const yearF = field('year');
  const addrF = field('hasAddress');
  const shopF = field('shop');
  const shopPF = field('shopProbability');
  const groupF = field('groupKey');
  const detailF = field('detail');
  const baseF = field('baseElevation');
  const shapeF = roofRow('shape');
  const roofHF = roofRow('height');
  const roofLF = roofRow('levels');
  const dirF = roofRow('direction');
  const ridgeF = roofRow('ridge');

  const sections: [string, Row[]][] = [
    [
      'Building',
      [
        selectRow('type', BUILDING_TYPES, typeF.get, typeF.set, (s) => s.type),
        numberRow('levels', levelsF.get, levelsF.set, (s) => String(s.levelHeights.length), { min: 1 }),
        numberRow('height', heightF.get, heightF.set, (s) => m(totalHeight(s)), { step: 0.5, min: 0 }),
        numberRow('min height', minHeightF.get, minHeightF.set, (s) => m(s.base), { step: 0.5, min: 0 }),
        numberRow('year', yearF.get, yearF.set, (s) => `era ${fmt(s.era)}`, { min: 1000, max: 2100 }),
        boolRow('has address', addrF.get, addrF.set, null),
        boolRow('shop', shopF.get, shopF.set, (s) => (s.shop ? 'yes' : 'no')),
        numberRow('shop prob.', shopPF.get, shopPF.set, null, { step: 0.05, min: 0, max: 1 }),
      ],
    ],
    [
      'Roof',
      [
        selectRow('shape', ROOF_SHAPES, shapeF.get, shapeF.set, (s) => s.roof.shape),
        numberRow('height', roofHF.get, roofHF.set, (s) => m(s.roof.height), { step: 0.25, min: 0 }),
        numberRow('levels', roofLF.get, roofLF.set, null, { min: 0 }),
        numberRow('direction', dirF.get, dirF.set, (s) => `${fmt(bearing(s.roof.slopeDirection), 0)}°`, {
          step: 15,
          min: 0,
          max: 360,
        }),
        selectRow('ridge', ['along', 'across'] as const, ridgeF.get, ridgeF.set, ridgeOf),
      ],
    ],
    [
      'Colours',
      [
        colourRow('wall', 'wall', (s) => s.palette.wall),
        colourRow('roof', 'roof', (s) => s.palette.roof),
        colourRow('trim', 'trim', (s) => s.palette.trim),
        colourRow('door', 'door', (s) => s.palette.door),
      ],
    ],
    [
      'Style',
      [
        selectRow(
          'region',
          ['de', 'us'] as const,
          (i) => i.style.region,
          (i, v) => patchInput(i, { style: { ...i.style, region: v ?? 'de' } }),
          (s) => `pack ${s.packId}`,
          false,
        ),
        modernityRow(),
        textRow('group key', groupF.get, groupF.set),
      ],
    ],
    [
      'Output',
      [
        selectRow('detail', ['full', 'massing'] as const, detailF.get, detailF.set, null),
        numberRow('base elev.', baseF.get, baseF.set, null, { step: 0.5 }),
      ],
    ],
  ];

  function modernityRow(): Row {
    const range = h('input', { attrs: { type: 'range', min: 0, max: 1, step: 0.01 } });
    range.addEventListener('input', () =>
      edit((i) => patchInput(i, { style: { ...i.style, modernity: Number(range.value) } })),
    );
    const f = frame('modernity', range, null);
    return {
      el: f.el,
      sync(i) {
        if (!isFocused(range)) range.value = String(i.style.modernity);
        f.inferred.textContent = fmt(i.style.modernity);
      },
    };
  }

  // --- seed row with re-roll and lock ---

  const seedInput = h('input', { attrs: { type: 'text' } });
  seedInput.addEventListener('input', () => edit((i) => patchInput(i, { seed: seedInput.value })));
  const reroll = (): void => edit((i) => patchInput(i, { seed: randomSeed() }));
  const lock = (): void => {
    const spec = generation.get().mesh?.debug?.spec;
    if (!spec) return;
    edit((i) =>
      patchColours(
        patchRoof(patchInput(i, { type: spec.type, levels: spec.levelHeights.length }), {
          shape: spec.roof.shape,
          height: Number(spec.roof.height.toFixed(2)),
        }),
        {
          wall: hex(spec.palette.wall),
          roof: hex(spec.palette.roof),
          trim: hex(spec.palette.trim),
          door: hex(spec.palette.door),
        },
      ),
    );
  };
  const seedSection = h(
    'section',
    {},
    h('h3', {}, 'Seed'),
    h('div', { class: 'row' }, h('label', {}, 'seed'), seedInput, h('span'), h('span')),
    h(
      'div',
      { class: 'buttons' },
      h('button', { title: 'New random seed (R)', on: { click: reroll } }, 'Re-roll'),
      h(
        'button',
        {
          title: 'Copy the resolved type, levels, roof and colours into the input so re-rolls keep them',
          on: { click: lock },
        },
        'Lock current',
      ),
    ),
  );

  container.append(seedSection);
  for (const [title, rows] of sections) {
    container.append(h('section', {}, h('h3', {}, title), ...rows.map((r) => r.el)));
  }

  const rows = sections.flatMap(([, r]) => r);
  const sync = (): void => {
    const input = store.get().input;
    const gen = generation.get();
    const spec = gen.mesh?.debug?.spec;
    if (!isFocused(seedInput)) seedInput.value = String(input.seed);
    for (const r of rows) r.sync(input, spec);
    container.classList.toggle('stale', gen.meshInput !== input);
  };
  store.subscribe((next, prev) => {
    if (next.input !== prev.input) sync();
  });
  generation.subscribe(sync);
  sync();

  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (
      e.key === 'r' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
    )
      reroll();
  });
}

/** Compass bearing (0 = north, 90 = east) of a footprint-space direction. */
function bearing(v: readonly [number, number]): number {
  return ((Math.atan2(v[0], v[1]) * 180) / Math.PI + 360) % 360;
}

function ridgeOf(spec: ResolvedSpec): string {
  if (spec.roof.shape === 'flat') return '';
  const a = spec.roof.ridgeAxis;
  const b = spec.metrics.box.axis;
  return Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.7 ? 'along' : 'across';
}
