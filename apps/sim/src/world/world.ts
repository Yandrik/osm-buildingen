/**
 * Streams z14 tiles around the player: terrain mesh (LOD by distance), painted ground
 * texture, trees, bridge decks and building cells. Answers the physics queries.
 */
import type { GeneratorPool } from '@osm-buildingen/three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LinearMipmapLinearFilter,
  type Material,
  Matrix4,
  Mesh,
  type MeshToonMaterial,
  Quaternion,
  RedFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, writeNormals } from '../render/toon';
import { Buildings, type Footprint } from './buildings';
import { TILE, X0, X1, Y0, Y1, inData, lonLatToWorld, slippyRect, tileKey, tileOrigin } from './frame';
import { eiffelTower } from './landmarks';
import { HeightGrid, terrainGeometry } from './terrain';
import { TileClient } from './tile-client';
import type { BridgeData } from './tile-protocol';

const GRID = 256;

interface Lod {
  stride: number;
  tex: number;
}

export interface WorldOptions {
  mobile: boolean;
}

interface Tile {
  tx: number;
  ty: number;
  key: string;
  e0: number;
  n0: number;
  grid: HeightGrid | null;
  terrainPending: boolean;
  mesh: Mesh | null;
  material: MeshToonMaterial;
  stride: number;
  texSize: number;
  paintPending: number;
  texture: Texture | null;
  detailState: 'none' | 'pending' | 'done';
  trees: InstancedMesh | null;
  treeData: Float32Array | null;
  bridges: Mesh | null;
  bridgeSegs: BridgeSeg[];
  d: number;
  removed: boolean;
}

interface BridgeSeg {
  ae: number;
  an: number;
  ah: number;
  be: number;
  bn: number;
  bh: number;
  half: number;
}

export interface Surface {
  height: number;
  /** Unit normal in three.js axes. */
  normal: Vector3;
  onBridge: boolean;
}

export class World {
  readonly group = new Group();
  readonly buildings: Buildings;
  private readonly tiles = new Map<string, Tile>();
  private readonly client: TileClient;
  private readonly far = new Group();
  private readonly farMaterial: MeshToonMaterial;
  private readonly mask: DataTexture;
  private readonly maskData: Uint8Array<ArrayBuffer>;
  private readonly treeGeometry: BufferGeometry;
  private readonly treeMaterial: Material;
  private readonly bridgeMaterial: Material;
  private readonly anisotropy: number;
  private readonly maxTexture: number;
  private eiffel: Group | null = null;
  private readonly eiffelAt = lonLatToWorld(2.29448, 48.85826);
  stats = { tiles: 0, loading: 0 };
  /** Radius in metres within which buildings are generated (on the ground). */
  buildingDistance = 350;

  constructor(
    renderer: WebGLRenderer,
    pool: GeneratorPool,
    private readonly options: WorldOptions,
  ) {
    this.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.maxTexture = Math.min(4096, renderer.capabilities.maxTextureSize);
    this.client = new TileClient(options.mobile ? 2 : 4);
    const buildingMaterial = toon({ vertexColors: true });
    this.buildings = new Buildings(pool, buildingMaterial);
    this.group.add(this.buildings.group, this.far);

    const w = X1 - X0 + 1;
    const h = Y0 - Y1 + 1;
    this.maskData = new Uint8Array(w * h);
    this.mask = new DataTexture(this.maskData, w, h, RedFormat, UnsignedByteType);
    this.mask.unpackAlignment = 1;
    this.mask.needsUpdate = true;
    this.farMaterial = toon({ color: new Color('#97bd6a') });
    this.farMaterial.onBeforeCompile = (shader) => {
      writeNormals(shader);
      shader.uniforms.loadedMask = { value: this.mask };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vWorldPos;\nuniform sampler2D loadedMask;',
        )
        .replace(
          'void main() {',
          `void main() {
            ivec2 t = ivec2(floor(vWorldPos.x / ${TILE.toFixed(1)}), floor(-vWorldPos.z / ${TILE.toFixed(1)}));
            if (t.x >= 0 && t.y >= 0 && t.x < ${w} && t.y < ${h} && texelFetch(loadedMask, t, 0).r > 0.5) discard;`,
        );
    };

    this.treeGeometry = treeGeometry();
    this.treeMaterial = toon({ vertexColors: true });
    this.bridgeMaterial = toon({ vertexColors: true, side: DoubleSide });
    this.loadFar();
  }

  /** Coarse z12 terrain under everything, hidden wherever a z14 tile is loaded. */
  private loadFar(): void {
    const z = 12;
    const s = 4;
    for (let x = Math.floor(X0 / s); x <= Math.floor(X1 / s); x++) {
      for (let y = Math.floor(Y1 / s); y <= Math.floor(Y0 / s); y++) {
        this.client
          .request({ kind: 'far', z, x, y, grid: 64 }, x, y)
          .then((r) => {
            const rect = slippyRect(z, x, y);
            const grid = new HeightGrid(r.heights, r.grid, rect.size);
            const mesh = new Mesh(terrainGeometry(grid, 1), this.farMaterial);
            mesh.position.set(rect.e, -3, -rect.n);
            mesh.receiveShadow = false;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            this.far.add(mesh);
          })
          .catch((e: unknown) => console.warn('far terrain', e));
      }
    }
  }

  private lodFor(d: number): Lod {
    const m = this.options.mobile;
    // The tile under the player gets ~0.4 m texels, which is what the eye sees from a bike.
    if (d < 150) return { stride: 1, tex: m ? 2048 : this.maxTexture };
    if (d < 600) return { stride: 1, tex: m ? 1024 : 2048 };
    if (d < 1800) return { stride: 2, tex: m ? 512 : 1024 };
    if (d < 4000) return { stride: 4, tex: 512 };
    return { stride: 8, tex: 256 };
  }

  update(e: number, n: number, heightAboveGround: number): void {
    const air = heightAboveGround > 30;
    const radius = air ? Math.min(9000, 4500 + heightAboveGround * 4) : 4000;
    // Flying, the radius grows with altitude so the city does not end just below the plane.
    const base = this.buildingDistance;
    const massRadius = air ? Math.min(Math.max(base, 2600), base + heightAboveGround * 2) : base;
    // Trees and bridges come with the building data, so load it at least that far out.
    const detailRadius = Math.max(massRadius, 900) + 600;

    const r = Math.ceil(radius / TILE) + 1;
    const ctx = X0 + Math.floor(e / TILE);
    const cty = Y0 - Math.floor(n / TILE);
    for (let ty = cty - r; ty <= cty + r; ty++) {
      for (let tx = ctx - r; tx <= ctx + r; tx++) {
        if (!inData(tx, ty)) continue;
        const key = tileKey(tx, ty);
        if (this.tiles.has(key)) continue;
        const o = tileOrigin(tx, ty);
        if (rectDistance(e, n, o.e, o.n, TILE) > radius) continue;
        this.tiles.set(key, this.newTile(tx, ty));
      }
    }

    const order = [...this.tiles.values()];
    for (const t of order) t.d = rectDistance(e, n, t.e0, t.n0, TILE);
    order.sort((a, b) => a.d - b.d);
    let loading = 0;
    for (const t of order) {
      if (t.d > radius + 1500) {
        this.removeTile(t);
        continue;
      }
      const lod = this.lodFor(t.d);
      // Keep the queue short and nearest-first so turning around reprioritises quickly.
      const free = this.client.load(t.tx, t.ty) < 3;
      if (!t.grid) {
        if (!t.terrainPending && free) this.requestTerrain(t);
        loading++;
        continue;
      }
      if (t.stride !== lod.stride) this.buildMesh(t, lod.stride);
      if (t.texSize !== lod.tex && t.paintPending !== lod.tex && free) this.requestPaint(t, lod.tex);
      if (!t.texture) loading++;
      if (t.d < detailRadius && t.detailState === 'none' && free) this.requestDetail(t);
      if (t.d > detailRadius + 800 && t.detailState === 'done') this.dropDetail(t);
      const wantTrees = t.d < (this.options.mobile ? 300 : 900);
      if (wantTrees && !t.trees && t.treeData) this.buildTrees(t);
      if (!wantTrees && t.trees) this.dropTrees(t);
    }
    this.buildings.update(e, n, heightAboveGround, massRadius);
    this.updateEiffel();
    this.stats = { tiles: this.tiles.size, loading };
  }

  private newTile(tx: number, ty: number): Tile {
    const o = tileOrigin(tx, ty);
    const material = toon({ color: '#ffffff' });
    return {
      tx,
      ty,
      key: tileKey(tx, ty),
      e0: o.e,
      n0: o.n,
      grid: null,
      terrainPending: false,
      mesh: null,
      material,
      stride: 0,
      texSize: 0,
      paintPending: 0,
      texture: null,
      detailState: 'none',
      trees: null,
      treeData: null,
      bridges: null,
      bridgeSegs: [],
      d: 0,
      removed: false,
    };
  }

  private requestTerrain(t: Tile): void {
    t.terrainPending = true;
    this.client
      .request({ kind: 'terrain', tx: t.tx, ty: t.ty, grid: GRID }, t.tx, t.ty)
      .then((r) => {
        t.terrainPending = false;
        if (t.removed) return;
        t.grid = new HeightGrid(r.heights, r.grid, TILE);
      })
      .catch((e: unknown) => console.warn('terrain', t.key, e));
  }

  private buildMesh(t: Tile, stride: number): void {
    if (!t.grid) return;
    const geometry = terrainGeometry(t.grid, stride);
    if (t.mesh) {
      t.mesh.geometry.dispose();
      t.mesh.geometry = geometry;
    } else {
      t.mesh = new Mesh(geometry, t.material);
      t.mesh.position.set(t.e0, 0, -t.n0);
      t.mesh.receiveShadow = true;
      t.mesh.matrixAutoUpdate = false;
      t.mesh.updateMatrix();
      this.group.add(t.mesh);
      this.setMask(t, true);
    }
    t.stride = stride;
  }

  private requestPaint(t: Tile, size: number): void {
    t.paintPending = size;
    this.client
      .request({ kind: 'paint', tx: t.tx, ty: t.ty, texSize: size }, t.tx, t.ty)
      .then((r) => {
        if (t.paintPending === size) t.paintPending = 0;
        if (t.removed) {
          r.bitmap.close();
          return;
        }
        const texture = new Texture(r.bitmap);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = false;
        texture.anisotropy = this.anisotropy;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.needsUpdate = true;
        const old = t.texture;
        t.texture = texture;
        t.texSize = size;
        t.material.map = texture;
        t.material.needsUpdate = true;
        if (old) {
          old.dispose();
          (old.image as ImageBitmap).close();
        }
      })
      .catch((e: unknown) => {
        t.paintPending = 0;
        console.warn('paint', t.key, e);
      });
  }

  private requestDetail(t: Tile): void {
    t.detailState = 'pending';
    this.client
      .request({ kind: 'detail', tx: t.tx, ty: t.ty }, t.tx, t.ty)
      .then((r) => {
        if (t.removed || t.detailState !== 'pending') return;
        t.detailState = 'done';
        t.treeData = r.trees;
        this.buildBridges(t, r.bridges);
        this.buildings.addTile(t.tx, t.ty, r.cells);
      })
      .catch((e: unknown) => {
        t.detailState = 'none';
        console.warn('detail', t.key, e);
      });
  }

  private dropDetail(t: Tile): void {
    this.buildings.removeTile(t.tx, t.ty);
    this.dropTrees(t);
    t.treeData = null;
    if (t.bridges) {
      this.group.remove(t.bridges);
      t.bridges.geometry.dispose();
      t.bridges = null;
    }
    t.bridgeSegs = [];
    t.detailState = 'none';
  }

  private removeTile(t: Tile): void {
    t.removed = true;
    this.dropDetail(t);
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    if (t.texture) {
      t.texture.dispose();
      (t.texture.image as ImageBitmap).close();
    }
    t.material.dispose();
    this.setMask(t, false);
    this.tiles.delete(t.key);
  }

  private setMask(t: Tile, on: boolean): void {
    const w = X1 - X0 + 1;
    this.maskData[(Y0 - t.ty) * w + (t.tx - X0)] = on ? 255 : 0;
    this.mask.needsUpdate = true;
  }

  private buildTrees(t: Tile): void {
    const data = t.treeData;
    if (!data || data.length === 0) return;
    const count = data.length / 4;
    const mesh = new InstancedMesh(this.treeGeometry, this.treeMaterial, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const p = new Vector3();
    const s = new Vector3();
    const c = new Color();
    for (let i = 0; i < count; i++) {
      const x = data[i * 4] as number;
      const n = data[i * 4 + 1] as number;
      const h = data[i * 4 + 2] as number;
      const k = data[i * 4 + 3] as number;
      q.setFromAxisAngle(up, (x * 7.13 + n * 3.7) % (Math.PI * 2));
      p.set(t.e0 + x, h - 0.2, -(t.n0 + n));
      s.set(k, k * (0.85 + ((i * 37) % 10) / 25), k);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      c.setHSL(0.24 + ((i * 13) % 10) / 160, 0.45, 0.85 + ((i * 7) % 10) / 60);
      mesh.setColorAt(i, c);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    t.trees = mesh;
    this.group.add(mesh);
  }

  private dropTrees(t: Tile): void {
    if (!t.trees) return;
    this.group.remove(t.trees);
    t.trees.dispose();
    t.trees = null;
  }

  private buildBridges(t: Tile, bridges: BridgeData[]): void {
    const pos: number[] = [];
    const col: number[] = [];
    const segs: BridgeSeg[] = [];
    const top = new Color('#62666c');
    const rail = new Color('#7d7268');
    const side = new Color('#cdbfa4');
    const quad = (a: number[], b: number[], c: number[], d: number[], colour: Color): void => {
      // a, b, c, d counter-clockwise seen from outside.
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v[0] as number, v[1] as number, v[2] as number);
        col.push(colour.r, colour.g, colour.b);
      }
    };
    const thick = 1.4;
    for (const b of bridges) {
      const half = b.width / 2;
      for (let i = 0; i + 5 < b.pts.length; i += 3) {
        const ax = b.pts[i] as number;
        const an = b.pts[i + 1] as number;
        const ah = b.pts[i + 2] as number;
        const bx = b.pts[i + 3] as number;
        const bn = b.pts[i + 4] as number;
        const bh = b.pts[i + 5] as number;
        const len = Math.hypot(bx - ax, bn - an);
        if (len < 0.01) continue;
        segs.push({ ae: t.e0 + ax, an: t.n0 + an, ah, be: t.e0 + bx, bn: t.n0 + bn, bh, half });
        // Left normal in the east/north plane; extend each segment a little to close joints.
        const ux = (bx - ax) / len;
        const un = (bn - an) / len;
        const lx = -un * half;
        const ln = ux * half;
        const ext = Math.min(half, 2);
        const p = (x: number, n: number, h: number): number[] => [x, h, -n];
        const sx = ax - ux * ext;
        const sn = an - un * ext;
        const ex = bx + ux * ext;
        const en = bn + un * ext;
        const aL = p(sx + lx, sn + ln, ah);
        const aR = p(sx - lx, sn - ln, ah);
        const bL = p(ex + lx, en + ln, bh);
        const bR = p(ex - lx, en - ln, bh);
        const aLb = p(sx + lx, sn + ln, ah - thick);
        const aRb = p(sx - lx, sn - ln, ah - thick);
        const bLb = p(ex + lx, en + ln, bh - thick);
        const bRb = p(ex - lx, en - ln, bh - thick);
        quad(aR, bR, bL, aL, b.rail ? rail : top);
        quad(aL, bL, bLb, aLb, side);
        quad(bR, aR, aRb, bRb, side);
        quad(aRb, aLb, bLb, bRb, side);
      }
    }
    t.bridgeSegs = segs;
    if (pos.length === 0) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, this.bridgeMaterial);
    mesh.position.set(t.e0, 0, -t.n0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    t.bridges = mesh;
    this.group.add(mesh);
  }

  private updateEiffel(): void {
    if (this.eiffel) return;
    const ground = this.groundHeight(this.eiffelAt.e, this.eiffelAt.n);
    if (ground === null) return;
    this.eiffel = eiffelTower();
    this.eiffel.position.set(this.eiffelAt.e, ground, -this.eiffelAt.n);
    // The tower's footprint diagonal runs SE-NW along the Champ de Mars.
    this.eiffel.rotation.y = (-43 * Math.PI) / 180;
    this.group.add(this.eiffel);
  }

  // --- physics queries ---------------------------------------------------------------

  private tileAt(e: number, n: number): Tile | undefined {
    const tx = X0 + Math.floor(e / TILE);
    const ty = Y0 - Math.floor(n / TILE);
    return this.tiles.get(tileKey(tx, ty));
  }

  /** Terrain height, or null where no terrain is loaded yet. */
  groundHeight(e: number, n: number): number | null {
    const t = this.tileAt(e, n);
    if (!t?.grid) return null;
    return t.grid.at(e - t.e0, n - t.n0);
  }

  /**
   * The surface a vehicle at height `y` stands on: the terrain, or a bridge deck that is
   * not more than `step` above it.
   */
  surface(e: number, n: number, y: number, step = 1.5): Surface | null {
    const h = this.groundHeight(e, n);
    if (h === null) return null;
    let height = h;
    let onBridge = false;
    const t = this.tileAt(e, n);
    for (const s of t?.bridgeSegs ?? []) {
      const dx = s.be - s.ae;
      const dn = s.bn - s.an;
      const len2 = dx * dx + dn * dn;
      const u = Math.max(0, Math.min(1, ((e - s.ae) * dx + (n - s.an) * dn) / len2));
      const pe = s.ae + dx * u - e;
      const pn = s.an + dn * u - n;
      if (pe * pe + pn * pn > s.half * s.half) continue;
      const deck = s.ah + (s.bh - s.ah) * u;
      if (deck > height && deck <= y + step) {
        height = deck;
        onBridge = true;
      }
    }
    const normal = onBridge ? new Vector3(0, 1, 0) : this.terrainNormal(e, n);
    return { height, normal, onBridge };
  }

  terrainNormal(e: number, n: number): Vector3 {
    const d = 2;
    const hE = this.groundHeight(e + d, n) ?? 0;
    const hW = this.groundHeight(e - d, n) ?? 0;
    const hN = this.groundHeight(e, n + d) ?? 0;
    const hS = this.groundHeight(e, n - d) ?? 0;
    // three.js: x = east, z = south.
    return new Vector3(hW - hE, 2 * d, hN - hS).normalize();
  }

  /**
   * Pushes a circle out of the buildings it overlaps at height y. Returns the push in
   * east/north metres, or null when nothing was hit.
   */
  collide(e: number, n: number, radius: number, y: number): { de: number; dn: number } | null {
    let de = 0;
    let dn = 0;
    let hit = false;
    for (const f of this.buildings.near(e, n, radius + 2)) {
      if (y > f.top || y + 1.5 < f.base) continue;
      if (e + radius < f.box[0] || e - radius > f.box[2] || n + radius < f.box[1] || n - radius > f.box[3])
        continue;
      const push = pushOut(f, e + de, n + dn, radius);
      if (push) {
        de += push[0];
        dn += push[1];
        hit = true;
      }
    }
    return hit ? { de, dn } : null;
  }

  /** True when the point is inside a building volume (for the plane). */
  insideBuilding(e: number, n: number, y: number): boolean {
    for (const f of this.buildings.near(e, n, 1)) {
      if (y > f.top || y < f.base) continue;
      if (e < f.box[0] || e > f.box[2] || n < f.box[1] || n > f.box[3]) continue;
      if (pointInRing(f.ring, e, n)) return true;
    }
    if (this.eiffel) {
      const dy = y - this.eiffel.position.y;
      if (dy > 0 && dy < 330) {
        const half = 62 * (1 - dy / 330) ** 1.8 + 3;
        const dx = e - this.eiffelAt.e;
        const dz = n - this.eiffelAt.n;
        if (dy > 60 && Math.abs(dx) < half && Math.abs(dz) < half) return true;
      }
    }
    return false;
  }

  /** True while the tiles the player needs are still loading. */
  ready(e: number, n: number): boolean {
    const t = this.tileAt(e, n);
    return !!t?.grid && !!t.mesh;
  }
}

function rectDistance(e: number, n: number, e0: number, n0: number, size: number): number {
  const dx = Math.max(0, e0 - e, e - (e0 + size));
  const dn = Math.max(0, n0 - n, n - (n0 + size));
  return Math.hypot(dx, dn);
}

function pointInRing(ring: Float64Array, e: number, n: number): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ae = ring[i * 2] as number;
    const an = ring[i * 2 + 1] as number;
    const be = ring[j * 2] as number;
    const bn = ring[j * 2 + 1] as number;
    if (an > n !== bn > n && e < ((be - ae) * (n - an)) / (bn - an) + ae) inside = !inside;
  }
  return inside;
}

function pushOut(f: Footprint, e: number, n: number, radius: number): [number, number] | null {
  const ring = f.ring;
  const count = ring.length / 2;
  let best = Number.POSITIVE_INFINITY;
  let bx = 0;
  let bn = 0;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ae = ring[j * 2] as number;
    const an = ring[j * 2 + 1] as number;
    const ce = ring[i * 2] as number;
    const cn = ring[i * 2 + 1] as number;
    const de = ce - ae;
    const dn = cn - an;
    const len2 = de * de + dn * dn || 1;
    const u = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / len2));
    const pe = ae + de * u;
    const pn = an + dn * u;
    const d2 = (e - pe) ** 2 + (n - pn) ** 2;
    if (d2 < best) {
      best = d2;
      bx = pe;
      bn = pn;
    }
  }
  const d = Math.sqrt(best);
  const inside = pointInRing(ring, e, n);
  if (!inside && d >= radius) return null;
  let ne = e - bx;
  let nn = n - bn;
  const len = Math.hypot(ne, nn) || 1;
  ne /= len;
  nn /= len;
  if (inside) return [-ne * (d + radius), -nn * (d + radius)];
  return [ne * (radius - d), nn * (radius - d)];
}

function treeGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.22, 0.3, 2.6, 5).toNonIndexed();
  trunk.translate(0, 1.3, 0);
  const crown = new IcosahedronGeometry(2.4, 0).toNonIndexed();
  crown.scale(1, 1.25, 1);
  crown.translate(0, 4.6, 0);
  const top = new ConeGeometry(1.6, 2.4, 6).toNonIndexed();
  top.translate(0, 6.6, 0);
  const paint = (g: BufferGeometry, colour: string): BufferGeometry => {
    const c = new Color(colour);
    const count = g.getAttribute('position').count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const merged = mergeGeometries([paint(trunk, '#7a5a3a'), paint(crown, '#4f9a3e'), paint(top, '#5aa646')]);
  merged.computeVertexNormals();
  return merged;
}
