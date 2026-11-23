/**
 * Landmarks the building generator cannot express. The Geofabrik extract has no heights,
 * so the Eiffel tower would otherwise be a 125 m square block.
 */
import { BufferAttribute, BufferGeometry, CylinderGeometry, Group, Mesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../render/toon';

/** Square frustum between two horizontal squares, as flat-shaded triangles. */
function frustum(
  bx: number,
  bz: number,
  bHalf: number,
  by: number,
  tx: number,
  tz: number,
  tHalf: number,
  ty: number,
): BufferGeometry {
  const corners = (x: number, z: number, h: number, y: number): number[][] => [
    [x - h, y, z + h],
    [x + h, y, z + h],
    [x + h, y, z - h],
    [x - h, y, z - h],
  ];
  const b = corners(bx, bz, bHalf, by);
  const t = corners(tx, tz, tHalf, ty);
  const pos: number[] = [];
  const tri = (p: number[], q: number[], r: number[]): void => {
    pos.push(...p, ...q, ...r);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const b0 = b[i] as number[];
    const b1 = b[j] as number[];
    const t0 = t[i] as number[];
    const t1 = t[j] as number[];
    tri(b0, b1, t1);
    tri(b0, t1, t0);
  }
  const [t0, t1, t2, t3] = t as [number[], number[], number[], number[]];
  tri(t0, t1, t2);
  tri(t0, t2, t3);
  const [b0, b1, b2, b3] = b as [number[], number[], number[], number[]];
  tri(b0, b2, b1);
  tri(b0, b3, b2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export function eiffelTower(): Group {
  const parts: BufferGeometry[] = [];
  const signs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;
  for (const [sx, sz] of signs) {
    // Lower legs lean in towards the first platform, then the second.
    parts.push(frustum(sx * 50, sz * 50, 11, 0, sx * 31, sz * 31, 7, 57));
    parts.push(frustum(sx * 31, sz * 31, 7, 57, sx * 15, sz * 15, 4.5, 115));
  }
  parts.push(frustum(0, 0, 44, 55, 0, 0, 42, 62));
  parts.push(frustum(0, 0, 23, 113, 0, 0, 22, 118));
  parts.push(frustum(0, 0, 16, 115, 0, 0, 5.5, 276));
  parts.push(frustum(0, 0, 9, 274, 0, 0, 8, 281));
  parts.push(frustum(0, 0, 5, 281, 0, 0, 2.2, 300));
  const antenna = new CylinderGeometry(0.6, 1.2, 30, 6).toNonIndexed();
  antenna.deleteAttribute('uv');
  antenna.deleteAttribute('normal');
  antenna.translate(0, 315, 0);
  parts.push(antenna);
  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, toon({ color: '#8b6b50' }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new Group();
  group.add(mesh);
  return group;
}
