/** Right panel: resolved spec, wall context, facade grids, solver and mesh statistics. */
import type { BuildingDebug, BuildingMesh, FacadeCell, Palette, ResolvedSpec } from '@osm-buildingen/core';
import { entranceInfo, facadeGrid, isEntrance } from './analysis';
import { type Child, clear, fmt, h, hex } from './dom';
import type { GenerationState, Store } from './state';

export function createInspector(container: HTMLElement, generation: Store<GenerationState>): void {
  // Remember which wall grids are open across re-renders.
  const openWalls = new Set<number>();
  let lastStreetWall = -2;

  function render(): void {
    const { mesh, error, elapsed } = generation.get();
    clear(container);
    if (!mesh) {
      container.append(h('p', { class: 'muted' }, error ? 'No mesh yet.' : 'Generating…'));
      return;
    }
    const debug = mesh.debug;
    if (!debug) {
      container.append(h('p', { class: 'muted' }, 'No debug data.'));
      return;
    }
    const { streetWall } = entranceInfo(debug);
    if (streetWall !== lastStreetWall) {
      // A new building: open the street wall's grid by default.
      openWalls.clear();
      if (streetWall >= 0) openWalls.add(streetWall);
      lastStreetWall = streetWall;
    }
    container.append(
      specSection(debug.spec),
      notesSection(debug.spec.notes),
      wallsSection(debug, streetWall),
      facadeSection(debug, streetWall),
      meshSection(mesh, elapsed),
    );
  }

  function facadeSection(debug: BuildingDebug, streetWall: number): HTMLElement {
    const facade = debug.facade;
    if (!facade) return section('Facade', h('p', { class: 'muted' }, 'No facade (massing detail).'));
    const grids = facadeGrid(debug);
    const walls = grids.map((rows, w) => {
      const details = h(
        'details',
        { on: { toggle: () => (details.open ? openWalls.add(w) : openWalls.delete(w)) } },
        h(
          'summary',
          {},
          `Wall ${w}`,
          w === streetWall ? h('span', { class: 'tag street' }, 'street') : null,
          h('span', { class: 'muted' }, ` ${rows.length} rows × ${rows[0]?.length ?? 0} cols`),
        ),
        gridTable(rows),
      );
      details.open = openWalls.has(w);
      return details;
    });
    return section(
      'Facade',
      kv([
        ['solver attempts', String(facade.attempts)],
        ['fallback', facade.fallback ? h('span', { class: 'warn' }, 'yes') : 'no'],
        ['cells', String(facade.cells.length)],
      ]),
      ...walls,
    );
  }

  generation.subscribe(render);
  render();
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', {}, h('h3', {}, title), ...children);
}

function kv(rows: [string, Child][]): HTMLTableElement {
  return h('table', { class: 'kv' }, ...rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v))));
}

function swatch(colour: number, label: string): HTMLElement {
  return h(
    'span',
    { class: 'swatch-item', title: `${label} ${hex(colour)}` },
    h('span', { class: 'swatch', style: { background: hex(colour) } }),
    label,
  );
}

function paletteView(p: Palette): HTMLElement {
  const keys = Object.keys(p) as (keyof Palette)[];
  return h('div', { class: 'palette' }, ...keys.map((k) => swatch(p[k], k)));
}

function specSection(s: ResolvedSpec): HTMLElement {
  const roof = s.roof;
  return section(
    'Resolved spec',
    kv([
      ['type', s.type],
      ['pack / region', `${s.packId} / ${s.region}`],
      ['era', fmt(s.era)],
      ['levels', `${s.levelHeights.length}`],
      ['level heights', s.levelHeights.map((v) => fmt(v)).join(', ')],
      ['wall height', `${fmt(s.wallHeight)} m (base ${fmt(s.base)} m, plinth ${fmt(s.plinthHeight)} m)`],
      [
        'roof',
        `${roof.shape}, ${fmt(roof.height)} m, overhang ${fmt(roof.overhang)} m${roof.parapet ? `, parapet ${fmt(roof.parapet)} m` : ''}`,
      ],
      [
        'wall style',
        `${s.wallStyle}${s.wallStyleFromLevel > 0 ? ` from level ${s.wallStyleFromLevel}` : ''}`,
      ],
      ['facade variant', s.facadeVariant || '—'],
      ['symmetric', s.symmetric ? 'yes' : 'no'],
      ['shop', s.shop ? 'yes' : 'no'],
      ['bay width', `${fmt(s.bayWidth)} m`],
      ['footprint', `${fmt(s.metrics.area, 1)} m², rect. ${fmt(s.metrics.rectangularity)}`],
      ['palette', paletteView(s.palette)],
    ]),
  );
}

function notesSection(notes: readonly string[]): HTMLElement {
  if (!notes.length) return section('Notes', h('p', { class: 'muted' }, 'none'));
  const el = section('Notes', h('ul', {}, ...notes.map((n) => h('li', {}, n))));
  el.classList.add('notes-warn');
  return el;
}

function wallsSection(debug: BuildingDebug, streetWall: number): HTMLElement {
  const spans = (list: readonly { from: number; to: number }[]): string =>
    list.map((s) => `${fmt(s.from, 1)}–${fmt(s.to, 1)}`).join(', ') || '—';
  return section(
    'Walls',
    h(
      'table',
      { class: 'grid-table walls' },
      h('tr', {}, ...['#', 'ring', 'len', 'street', 'open', 'blocked', 'shared'].map((t) => h('th', {}, t))),
      ...debug.walls.map((w, i) => {
        const c = debug.context[i];
        return h(
          'tr',
          { class: i === streetWall ? 'street-row' : undefined },
          h('td', {}, String(w.index)),
          h('td', {}, w.ring === 0 ? 'outer' : `hole ${w.ring}`),
          h('td', {}, fmt(w.length, 1)),
          h('td', {}, c ? fmt(c.streetScore) : ''),
          h('td', {}, c ? fmt(c.openFraction) : ''),
          h('td', { class: c?.blocked.length ? 'blocked-text' : undefined }, c ? spans(c.blocked) : ''),
          h('td', { class: c?.shared.length ? 'shared-text' : undefined }, c ? spans(c.shared) : ''),
        );
      }),
    ),
  );
}

/** Rows top to bottom, one cell per column; blocked cells shaded, entrances marked. */
function gridTable(rows: FacadeCell[][]): HTMLElement {
  const ordered = [...rows].reverse();
  return h(
    'table',
    { class: 'grid-table facade' },
    ...ordered.map((row, r) =>
      h(
        'tr',
        {},
        h('th', {}, String(rows.length - 1 - r)),
        ...(row ?? []).map((c) =>
          h(
            'td',
            {
              class:
                [c.blocked ? 'blocked' : '', isEntrance(c) ? 'entrance' : ''].join(' ').trim() || undefined,
              title: `x ${fmt(c.x)} y ${fmt(c.y)} · ${fmt(c.width)}×${fmt(c.height)} m`,
            },
            c.tile,
          ),
        ),
      ),
    ),
  );
}

function meshSection(mesh: BuildingMesh, elapsed: number): HTMLElement {
  const timings = mesh.debug?.timings ?? {};
  const b = mesh.bounds;
  const v3 = (v: readonly number[]): string => v.map((n) => fmt(n, 1)).join(', ');
  return section(
    'Mesh',
    kv([
      ['triangles', String(mesh.indices.length / 3)],
      ['vertices', String(mesh.positions.length / 3)],
      ['roof faces', String(mesh.debug?.roofFaces ?? '')],
      ['bounds min', v3(b.min)],
      ['bounds max', v3(b.max)],
      ['generate (wall clock)', `${fmt(elapsed, 2)} ms`],
      ...Object.entries(timings).map(([k, v]): [string, Child] => [`· ${k}`, `${fmt(v, 3)} ms`]),
    ]),
  );
}
