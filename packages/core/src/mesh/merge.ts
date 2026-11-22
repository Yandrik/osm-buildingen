import type { BuildingMesh } from '../types';

/** Concatenates meshes into one. */
export function mergeMeshes(meshes: readonly BuildingMesh[]): BuildingMesh {
  let vertices = 0;
  let indexCount = 0;
  for (const m of meshes) {
    vertices += m.positions.length / 3;
    indexCount += m.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Uint8Array(vertices * 3);
  const indices = new Uint32Array(indexCount);
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let v = 0;
  let i = 0;
  for (const m of meshes) {
    positions.set(m.positions, v * 3);
    normals.set(m.normals, v * 3);
    colors.set(m.colors, v * 3);
    for (let k = 0; k < m.indices.length; k++) indices[i + k] = (m.indices[k] as number) + v;
    if (m.positions.length > 0) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, m.bounds.min[k] as number);
        max[k] = Math.max(max[k] as number, m.bounds.max[k] as number);
      }
    }
    v += m.positions.length / 3;
    i += m.indices.length;
  }
  if (vertices === 0) {
    min.fill(0);
    max.fill(0);
  }
  return { positions, normals, colors, indices, bounds: { min, max } };
}
