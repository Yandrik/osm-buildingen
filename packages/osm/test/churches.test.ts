import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBuilding } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { buildInputs, parseOsmXml } from '../src';

/**
 * Two churches mapped the common way: towers and apse as building:part, the nave
 * only as the outline. Regression test for "the nave is missing" and for dome roofs.
 */
const file = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ulm-churches.osm');
const { inputs, meta } = buildInputs(parseOsmXml(readFileSync(file, 'utf8')), {
  style: { region: 'de', modernity: 0.3 },
});
const find = (name: string) => {
  const i = meta.findIndex((m) => m.tags.name === name);
  if (i < 0) throw new Error(`${name} not in fixture`);
  return { input: inputs[i] as (typeof inputs)[number], meta: meta[i] as (typeof meta)[number] };
};

describe('churches with parts for the towers only', () => {
  it('passes dome roofs through', () => {
    const { input } = find('Pauluskirche');
    expect(input.parts?.length).toBe(4);
    expect(input.parts?.filter((p) => p.roof?.shape === 'dome').length).toBe(2);
  });

  it('builds the nave from the outline, under the towers', () => {
    for (const [name, parts, top] of [
      ['Pauluskirche', 4, 50],
      ['Sankt Georg', 5, 86],
    ] as const) {
      const { input } = find(name);
      const mesh = generateBuilding({ ...input, debug: true });
      const built = mesh.debug?.parts ?? [];
      expect(built.length).toBe(parts + 1);
      const body = built[built.length - 1];
      // The body is most of the outline and carries the outline's own roof.
      expect(body?.spec.metrics.area).toBeGreaterThan(0.5 * (mesh.debug?.spec.metrics.area ?? 0));
      expect(body?.spec.roof.shape).toBe('gabled');
      expect(body && body.spec.base + body.spec.wallHeight + body.spec.roof.height).toBeCloseTo(
        input.height ?? 0,
        1,
      );
      // The mapped top, plus the cross on the tip.
      expect(mesh.bounds.max[1]).toBeGreaterThan(top - 0.5);
      expect(mesh.bounds.max[1]).toBeLessThan(top + 3.5);
    }
  });

  it('decorates the mapped towers with a belfry and the nave with church windows', () => {
    const { input } = find('Sankt Georg');
    expect(input.type).toBe('worship');
    const parts = generateBuilding({ ...input, debug: true }).debug?.parts ?? [];
    const towers = parts.filter((p) => p.spec.volume === 'tower');
    expect(towers.length).toBeGreaterThan(0);
    const tiles = (p: (typeof parts)[number]): string[] => (p.facade?.cells ?? []).map((c) => c.tile);
    expect(towers.some((t) => tiles(t).some((id) => id.startsWith('belfry_')))).toBe(true);
    const nave = parts.find((p) => p.spec.volume === 'main');
    expect(nave && tiles(nave).some((id) => id.startsWith('win_'))).toBe(true);
  });

  it('puts the portal on a wall wide enough for it, not on the round porch', () => {
    const { input } = find('Pauluskirche');
    const parts = generateBuilding({ ...input, debug: true }).debug?.parts ?? [];
    const withPortal = parts.filter((p) => (p.facade?.cells ?? []).some((c) => c.tile.startsWith('portal_')));
    expect(withPortal.length).toBe(1);
    expect(withPortal[0]?.spec.metrics.area).toBeGreaterThan(1000);
  });

  it('passes the faith on', () => {
    expect(find('Sankt Georg').input.faith).toBe('christian');
    expect(find('Pauluskirche').input.faith).toBe('christian');
  });
});

describe('Ulmer Münster', () => {
  const minster = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ulm-minster.osm');
  const built = buildInputs(parseOsmXml(readFileSync(minster, 'utf8')), {
    style: { region: 'de', modernity: 0.3 },
  });
  const at = (name: string) => {
    const i = built.meta.findIndex((m) => m.tags.name === name);
    if (i < 0) throw new Error(`${name} not in fixture`);
    return built.inputs[i] as (typeof built.inputs)[number];
  };
  const parts = generateBuilding({ ...at('Ulmer Münster'), debug: true }).debug?.parts ?? [];
  const tiles = (p: (typeof parts)[number]): string[] => (p.facade?.cells ?? []).map((c) => c.tile);

  it('keeps every mapped part and reads its buttresses as such', () => {
    const mapped = at('Ulmer Münster').parts?.length ?? 0;
    expect(mapped).toBeGreaterThan(50);
    expect(parts.length).toBeGreaterThanOrEqual(mapped);
    const count = (v: string): number => parts.filter((p) => p.spec.volume === v).length;
    // The west tower, its octagon, and the two east towers with their upper stages.
    expect(count('tower')).toBe(6);
    expect(count('small')).toBeGreaterThan(40);
    // Buttresses carry no openings.
    for (const p of parts.filter((q) => q.spec.volume === 'small'))
      expect(tiles(p).every((id) => id === 'blank')).toBe(true);
  });

  it('puts windows between the buttresses of both aisles and one portal in the west porch', () => {
    const aisles = parts.filter((p) => p.spec.volume === 'main' && p.spec.metrics.area > 1500);
    expect(aisles.length).toBe(2);
    for (const aisle of aisles)
      expect(tiles(aisle).filter((id) => id === 'win_gothic').length).toBeGreaterThanOrEqual(15);
    const portals = parts.filter((p) => tiles(p).some((id) => id.startsWith('portal_')));
    expect(portals.length).toBe(1);
    // The porch: the body under the lean-to roof mapped from 14 m up, flat at that height.
    expect(portals[0]?.spec.wallHeight).toBe(14);
    expect(portals[0]?.spec.roof.shape).toBe('flat');
    // At the west end (only the buttresses beside it reach a little further).
    const west = Math.min(...parts.flatMap((p) => p.spec.footprint.outer.map((q) => q[0])));
    expect(Math.min(...(portals[0]?.spec.footprint.outer.map((q) => q[0]) ?? []))).toBeLessThan(west + 3);
  });

  it('gives the orthodox chapel beside it a gilded onion on the ridge', () => {
    const chapel = at('Valentinskapelle');
    expect(chapel.faith).toBe('orthodox');
    const turret = generateBuilding({ ...chapel, debug: true }).debug?.parts?.[0];
    expect(turret?.spec.roof.shape).toBe('onion');
    expect(turret?.spec.volume).toBe('tower');
  });

  it('gives the synagogue no steeple and no cross', () => {
    const synagogue = at('Neue Synagoge Ulm');
    expect(synagogue.faith).toBe('jewish');
    const mesh = generateBuilding({ ...synagogue, debug: true });
    expect(mesh.debug?.parts).toBeUndefined();
    expect(mesh.bounds.max[1]).toBeLessThan(18);
  });
});
