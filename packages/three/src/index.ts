import type { BuildingMesh } from '@osm-buildingen/core';
import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
} from 'three';

export { createGeneratorPool } from './pool';
export type { GeneratorPool, GeneratorPoolOptions, GenerateResult } from './pool';

/** One building as its own geometry. Prefer `mergeBuildings` for whole map tiles. */
export function toBufferGeometry(mesh: BuildingMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(mesh.colors, 3, true));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface BuildingRange {
  /** Position of the building in the list passed to `mergeBuildings`. */
  building: number;
  indexStart: number;
  indexCount: number;
  vertexStart: number;
  vertexCount: number;
}

export interface MergedBuildings {
  geometry: BufferGeometry;
  /** Where each building sits inside the merged buffers (for picking and highlighting). */
  ranges: BuildingRange[];
}

/**
 * Merges many buildings into one geometry: one draw call per map tile.
 * `offsets` moves each building (x east, y up, z south), e.g. to place it in the tile.
 */
export function mergeBuildings(
  meshes: readonly BuildingMesh[],
  offsets?: readonly (readonly [number, number, number] | undefined)[],
): MergedBuildings {
  let vertices = 0;
  let indices = 0;
  for (const m of meshes) {
    vertices += m.positions.length / 3;
    indices += m.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Uint8Array(vertices * 3);
  const index = new Uint32Array(indices);
  const ranges: BuildingRange[] = [];
  let v = 0;
  let i = 0;
  meshes.forEach((m, building) => {
    const count = m.positions.length / 3;
    const off = offsets?.[building];
    positions.set(m.positions, v * 3);
    if (off) {
      for (let k = 0; k < count; k++) {
        const o = (v + k) * 3;
        positions[o] = (positions[o] as number) + off[0];
        positions[o + 1] = (positions[o + 1] as number) + off[1];
        positions[o + 2] = (positions[o + 2] as number) + off[2];
      }
    }
    normals.set(m.normals, v * 3);
    colors.set(m.colors, v * 3);
    for (let k = 0; k < m.indices.length; k++) index[i + k] = (m.indices[k] as number) + v;
    ranges.push({
      building,
      indexStart: i,
      indexCount: m.indices.length,
      vertexStart: v,
      vertexCount: count,
    });
    v += count;
    i += m.indices.length;
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3, true));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, ranges };
}

/** Finds the building a raycast hit belongs to. `faceIndex` is the triangle index from three's Raycaster. */
export function buildingAtFace(ranges: readonly BuildingRange[], faceIndex: number): number {
  const at = faceIndex * 3;
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid] as BuildingRange;
    if (at < r.indexStart) hi = mid - 1;
    else if (at >= r.indexStart + r.indexCount) lo = mid + 1;
    else return r.building;
  }
  return -1;
}

/**
 * Shared material for all buildings: vertex colours, lit, single sided.
 * Normals are already per face, so no flat-shading recomputation is needed.
 */
export function createBuildingMaterial(parameters: MeshLambertMaterialParameters = {}): Material {
  return new MeshLambertMaterial({ vertexColors: true, ...parameters });
}
