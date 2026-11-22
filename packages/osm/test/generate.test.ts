import { readFileSync } from 'node:fs';
import { generateBuilding } from '@osm-buildingen/core';
import { describe, expect, it } from 'vitest';
import { buildInputs, parseOsmXml } from '../src';

describe('core accepts every input from the Ulm fixture', () => {
  const data = parseOsmXml(readFileSync(new URL('./fixtures/ulm-minster.osm', import.meta.url), 'utf8'));
  const { inputs, meta } = buildInputs(data, { style: { region: 'de', modernity: 0.4 } });

  it('generates a valid full-detail mesh for every building', () => {
    const failures: string[] = [];
    inputs.forEach((input, i) => {
      const id = `${meta[i]?.osmType} ${meta[i]?.osmId}`;
      try {
        const mesh = generateBuilding({ ...input, detail: 'full' });
        const vertices = mesh.positions.length / 3;
        if (vertices === 0 || mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
          failures.push(`${id}: empty mesh`);
          return;
        }
        if (mesh.normals.length !== mesh.positions.length || mesh.colors.length !== vertices * 3) {
          failures.push(`${id}: attribute length mismatch`);
          return;
        }
        if (!mesh.positions.every(Number.isFinite) || !mesh.normals.every(Number.isFinite)) {
          failures.push(`${id}: non-finite vertex data`);
          return;
        }
        if (mesh.indices.some((k) => k >= vertices)) failures.push(`${id}: index out of range`);
      } catch (error) {
        failures.push(`${id}: ${(error as Error).message}`);
      }
    });
    expect(failures).toEqual([]);
  });
});
