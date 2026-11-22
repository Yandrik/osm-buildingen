/**
 * Inspector for the selected building: OSM element and tags, the adapter's
 * decision, the generator's resolved spec and notes (from one main-thread
 * `generateBuilding({ ...input, debug: true })`), the exact input as JSON, and a
 * link that opens it in the studio.
 */
import type { BuildingInput, Palette, ResolvedSpec } from '@osm-buildingen/core';
import type { BuildingMeta } from '@osm-buildingen/osm';
import type { Inspection } from './analysis';
import { type Child, append, clear, fmt, h, hex } from './dom';
import { inputToJson } from './permalink';

export interface InspectData {
  index: number;
  meta: BuildingMeta;
  input: BuildingInput;
  /** Error from the worker pool for this building, if generation failed there. */
  poolError: string | undefined;
  inspection: Inspection;
  /** Level the building is shown at. */
  level: 'full' | 'massing';
  groupSize: number;
  /** Resolves to the studio URL (encoding is async). */
  studioLink: Promise<string>;
}

export interface InspectorActions {
  copy(text: string, what: string): void;
  focus(index: number): void;
  close(): void;
}

export interface InspectorPanel {
  show(data: InspectData | null): void;
}

const section = (title: string, ...children: Child[]): HTMLElement =>
  h('section', {}, h('h3', {}, title), ...children);

const kv = (rows: readonly [string, Child][]): HTMLElement =>
  h('table', { class: 'kv' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));

const osmUrl = (m: BuildingMeta): string => `https://www.openstreetmap.org/${m.osmType}/${m.osmId}`;

function swatches(palette: Palette): HTMLElement {
  return h(
    'div',
    { class: 'palette' },
    ...Object.entries(palette).map(([name, colour]) =>
      h(
        'span',
        { class: 'swatch-item', title: hex(colour as number) },
        h('span', { class: 'swatch', style: { background: hex(colour as number) } }),
        name,
      ),
    ),
  );
}

function specRows(spec: ResolvedSpec): [string, Child][] {
  return [
    ['type', spec.type],
    ['pack', spec.packId],
    ['era', fmt(spec.era)],
    ['levels', `${spec.levelHeights.length} (${spec.levelHeights.map((v) => fmt(v, 1)).join(' / ')} m)`],
    ['wall height', `${fmt(spec.wallHeight)} m${spec.base > 0 ? ` from ${fmt(spec.base)} m` : ''}`],
    ['roof', `${spec.roof.shape}, ${fmt(spec.roof.height)} m`],
    [
      'wall style',
      `${spec.wallStyle}${spec.wallStyleFromLevel > 0 ? ` from level ${spec.wallStyleFromLevel}` : ''}`,
    ],
    ['facade variant', spec.facadeVariant || '–'],
    ['shop', spec.shop ? 'yes' : 'no'],
    ['symmetric', spec.symmetric ? 'yes' : 'no'],
    ['bay width', `${fmt(spec.bayWidth)} m`],
    ['footprint', `${fmt(spec.metrics.area, 0)} m², rect. ${fmt(spec.metrics.rectangularity)}`],
  ];
}

export function createInspector(root: HTMLElement, actions: InspectorActions): InspectorPanel {
  return {
    show(data) {
      clear(root);
      root.hidden = data === null;
      if (!data) return;
      const { meta, input, inspection } = data;
      const debug = inspection.debug;
      const studio = h(
        'a',
        { class: 'button', attrs: { target: '_blank', rel: 'noopener' } },
        'Open in studio',
      );
      studio.title = 'Input recentred on the building (studio origin); seed unchanged';
      data.studioLink.then(
        (url) => {
          studio.setAttribute('href', url);
        },
        () => {
          studio.textContent = 'Studio link failed';
        },
      );
      const json = inputToJson(input);
      const parts = debug?.parts && debug.parts.length > 0 ? debug.parts : debug ? [debug] : [];
      const notes = parts.flatMap((p, i) =>
        p.spec.notes.map((n) => (parts.length > 1 ? `part ${i}: ${n}` : n)),
      );
      const fallback = parts.some((p) => p.facade?.fallback);
      const timings = new Map<string, number>();
      for (const p of parts) {
        for (const [k, v] of Object.entries(p.timings)) timings.set(k, (timings.get(k) ?? 0) + v);
      }
      const roads = input.roads ?? [];

      append(root, [
        h(
          'div',
          { class: 'inspector-head' },
          h(
            'a',
            { attrs: { href: osmUrl(meta), target: '_blank', rel: 'noopener' } },
            `${meta.osmType} ${meta.osmId}`,
          ),
          meta.ring > 0 ? h('span', { class: 'muted' }, ` ring ${meta.ring}`) : null,
          h('span', { class: 'spacer' }),
          h('button', { on: { click: () => actions.focus(data.index) }, title: 'Centre the camera' }, 'Zoom'),
          h('button', { on: { click: () => actions.close() }, title: 'Deselect (Esc)' }, '×'),
        ),
        h(
          'div',
          { class: 'buttons' },
          studio,
          h('button', { on: { click: () => actions.copy(json, 'Input JSON') } }, 'Copy input JSON'),
        ),
        data.poolError
          ? h('p', { class: 'error-box' }, `Generation failed in the worker: ${data.poolError}`)
          : null,
        inspection.error
          ? h('p', { class: 'error-box' }, `generateBuilding threw: ${inspection.error}`)
          : null,
        section(
          'Adapter decision',
          kv([
            ['type', meta.type ?? h('span', { class: 'muted' }, 'left to core')],
            ['reason', meta.typeReason],
            ['special', meta.special ? h('span', { class: 'warn' }, 'yes (massing)') : 'no'],
            [
              'group',
              `${meta.groupKey}${data.groupSize > 1 ? ` (${data.groupSize} buildings)` : ' (alone)'}`,
            ],
            ['area', `${fmt(meta.area, 1)} m²`],
            ['address', input.hasAddress ? 'yes' : 'no'],
            ['parts', meta.partIds.length > 0 ? String(meta.partIds.length) : '–'],
            ['neighbours', String(input.neighbours?.length ?? 0)],
            ['roads', `${roads.length}${roads.some((r) => r.passage) ? ' (passage)' : ''}`],
            ['detail', `${data.level}${input.detail ? ` (input: ${input.detail})` : ''}`],
          ]),
        ),
        debug ? section('Resolved spec', kv(specRows(debug.spec)), swatches(debug.spec.palette)) : null,
        debug
          ? section(
              'Notes',
              notes.length > 0
                ? h('ul', { class: 'notes' }, ...notes.map((n) => h('li', {}, n)))
                : h('p', { class: 'muted' }, 'none'),
              fallback ? h('p', {}, h('span', { class: 'warn' }, 'facade solver fell back')) : null,
            )
          : null,
        debug
          ? section(
              'Mesh (main thread, debug on)',
              kv([
                ['triangles', String(inspection.triangles)],
                ['vertices', String(inspection.vertices)],
                ['wall time', `${fmt(inspection.ms)} ms`],
                ...[...timings].map(([k, v]): [string, Child] => [k, `${fmt(v, 3)} ms`]),
              ]),
            )
          : null,
        section(
          'OSM tags',
          kv(
            Object.entries(meta.tags)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]): [string, Child] => [k, v]),
          ),
        ),
        section(
          'BuildingInput',
          h(
            'details',
            {},
            h('summary', {}, `${(json.length / 1024).toFixed(1)} kB JSON`),
            h('pre', { class: 'json' }, json),
          ),
        ),
      ]);
    },
  };
}
