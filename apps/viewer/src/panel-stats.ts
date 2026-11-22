/**
 * Stats panel: counts, timings, worst tiles and buildings, failures. Live render
 * numbers (FPS, draw calls) are patched in place; the rest is rebuilt only when
 * it changed, so clicks on list entries are not lost to a re-render.
 */
import type { BuildStats } from '@osm-buildingen/osm';
import type { LoadSummary } from './data';
import { type Child, clear, fmt, h } from './dom';
import type { GenerationStats } from './generation';
import type { RenderStats } from './scene';

export interface BuildingTime {
  index: number;
  label: string;
  ms: number;
  triangles: number;
}

export interface StatsData {
  poolSize: number;
  load: LoadSummary | null;
  buildMs: number | null;
  buildWallMs: number | null;
  buildStats: BuildStats | null;
  buildings: number;
  roads: number;
  generation: GenerationStats | null;
  /** Worst buildings by time, with the source of the numbers. */
  worst: { source: string; list: BuildingTime[] } | null;
  failures: { index: number; label: string; message: string }[];
  profile: { done: number; total: number } | null;
}

export interface StatsActions {
  select(index: number): void;
  profile(): void;
  cancelProfile(): void;
}

export interface StatsPanel {
  update(data: StatsData, render: RenderStats): void;
}

const ms = (v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : `${fmt(v, 0)} ms`;
const count = (n: number): string => n.toLocaleString('en-US');

const kv = (rows: readonly [string, Child][]): HTMLElement =>
  h('table', { class: 'kv' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));

export function createStats(root: HTMLElement, actions: StatsActions): StatsPanel {
  const live = {
    fps: h('span'),
    calls: h('span'),
    rendered: h('span'),
  };
  const body = h('div');
  root.append(
    h('h3', {}, 'Render'),
    kv([
      ['FPS', live.fps],
      ['draw calls', live.calls],
      ['triangles drawn', live.rendered],
    ]),
    body,
  );
  let signature = '';

  function render(d: StatsData): void {
    clear(body);
    const g = d.generation;
    const tiles = g ? [...g.tiles].sort((a, b) => b.workerMs - a.workerMs).slice(0, 10) : [];
    const sumBuildingsStats = d.buildStats;
    body.append(
      h('h3', {}, 'Area'),
      kv([
        ['source', d.load ? `${d.load.name} (${d.load.format})` : '–'],
        [
          'OSM elements',
          d.load
            ? `${count(d.load.nodes)} nodes, ${count(d.load.ways)} ways, ${count(d.load.relations)} rel.`
            : '–',
        ],
        ['buildings', count(d.buildings)],
        ['roads', count(d.roads)],
        [
          'skipped',
          sumBuildingsStats
            ? `${sumBuildingsStats.skippedIncomplete} incomplete, ${sumBuildingsStats.skippedByTag} by tag, ${sumBuildingsStats.skippedOutside} outside, ${sumBuildingsStats.orphanParts} orphan parts`
            : '–',
        ],
      ]),
      h('h3', {}, 'Timings'),
      kv([
        ['read / download', ms(d.load?.readMs)],
        ['parse', ms(d.load?.parseMs)],
        ['buildInputs', `${ms(d.buildMs)} (round trip ${ms(d.buildWallMs)})`],
        ['first tile', ms(g?.firstTileMs)],
        ['generation wall (last round)', g?.running ? 'running…' : ms(g?.wallMs)],
        ['worker time (sum)', `${ms(g?.workerMs)} on ${d.poolSize} workers`],
      ]),
      h('h3', {}, 'Geometry'),
      kv([
        ['tiles', g ? `${g.tilesDone} / ${g.tilesTotal}` : '–'],
        ['triangles', g ? count(g.triangles) : '–'],
        ['vertices', g ? count(g.vertices) : '–'],
        [
          'per building',
          g && d.buildings > 0 ? `${count(Math.round(g.triangles / d.buildings))} triangles` : '–',
        ],
      ]),
      h('h3', {}, 'Slowest tiles (worker time)'),
      tiles.length > 0
        ? h(
            'table',
            { class: 'grid-table' },
            h(
              'tr',
              {},
              h('th', {}, 'tile'),
              h('th', {}, 'bldg'),
              h('th', {}, 'level'),
              h('th', {}, 'worker'),
              h('th', {}, 'wall'),
              h('th', {}, 'tris'),
            ),
            ...tiles.map((t) =>
              h(
                'tr',
                {},
                h('td', {}, t.key),
                h('td', {}, String(t.buildings)),
                h('td', {}, t.level),
                h('td', {}, ms(t.workerMs)),
                h('td', {}, ms(t.wallMs)),
                h('td', {}, count(t.triangles)),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'none yet'),
      h('h3', {}, 'Slowest buildings'),
      d.worst && d.worst.list.length > 0
        ? h(
            'div',
            {},
            h('p', { class: 'muted' }, d.worst.source),
            h(
              'table',
              { class: 'grid-table clickable' },
              h('tr', {}, h('th', {}, 'building'), h('th', {}, 'time'), h('th', {}, 'tris')),
              ...d.worst.list.map((b) =>
                h(
                  'tr',
                  { on: { click: () => actions.select(b.index) } },
                  h('td', {}, b.label),
                  h('td', {}, `${fmt(b.ms, 2)} ms`),
                  h('td', {}, count(b.triangles)),
                ),
              ),
            ),
          )
        : h(
            'p',
            { class: 'muted' },
            'The pool reports time per batch only. Turn on debug data, or run a profile (main thread, one call per building).',
          ),
      h(
        'div',
        { class: 'buttons' },
        d.profile
          ? h(
              'button',
              { on: { click: () => actions.cancelProfile() } },
              `Profiling ${d.profile.done} / ${d.profile.total} — cancel`,
            )
          : h(
              'button',
              { on: { click: () => actions.profile() }, attrs: { disabled: d.buildings === 0 } },
              'Profile run',
            ),
      ),
      h('h3', {}, `Failed buildings (${d.failures.length})`),
      d.failures.length > 0
        ? h(
            'ul',
            { class: 'failures' },
            ...d.failures.map((f) =>
              h(
                'li',
                {},
                h(
                  'a',
                  {
                    attrs: { href: '#' },
                    on: {
                      click: (e) => {
                        e.preventDefault();
                        actions.select(f.index);
                      },
                    },
                  },
                  f.label,
                ),
                ' ',
                h('span', { class: 'muted' }, f.message),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'none'),
    );
  }

  return {
    update(data, r) {
      live.fps.textContent = fmt(r.fps, 0);
      live.calls.textContent = String(r.calls);
      live.rendered.textContent = count(r.triangles);
      const next = JSON.stringify(data);
      if (next === signature) return;
      signature = next;
      render(data);
    },
  };
}
