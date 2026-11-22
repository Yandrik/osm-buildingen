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
      expect(mesh.bounds.max[1]).toBeCloseTo(top, 0);
    }
  });
});
