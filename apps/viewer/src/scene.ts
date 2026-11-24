/**
 * three.js setup: renderer, camera and controls, lights, ground, roads, trees, and the
 * tile meshes (one merged mesh per tile, all sharing one material).
 *
 * Input frame (x east, y north) maps to three as (x, height, -y).
 */
import type { Vec2 } from '@osm-buildingen/core';
import type { MapRoad } from '@osm-buildingen/osm';

/** What the scene draws of a road; OSM and vector-tile roads both have it. */
export type RoadLine = Pick<MapRoad, 'line' | 'width' | 'kind'>;
import { type BuildingRange, createBuildingMaterial } from '@osm-buildingen/three';
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cssVar } from './dom';
import { type Rgb, type Strip, hexToRgb, stripGeometry } from './strips';
import type { Level } from './tiles';

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One generated tile in the scene. */
export interface TileView {
  key: string;
  mesh: Mesh;
  ranges: BuildingRange[];
  /** Global building index for each range (`ranges[k].building` indexes this). */
  buildings: number[];
  /** Generated vertex colours, kept to restore after overlays and highlights. */
  baseColours: Uint8Array;
  level: Level;
  /** Input generation the tile belongs to; older tiles are shown until replaced but not picked. */
  generation: number;
  triangles: number;
  vertices: number;
}

export interface RenderStats {
  calls: number;
  triangles: number;
  fps: number;
}

export interface SceneView {
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** For extra overlay geometry (outlines, links, passages). */
  readonly overlays: Group;
  setArea(extent: Extent): void;
  fit(extent: Extent): void;
  /** Moves the target to a point, keeping the view direction. */
  focus(point: Vec2, radius: number): void;
  setRoads(roads: readonly RoadLine[]): void;
  /** x, y, scale per tree (input frame); null removes them. */
  setTrees(points: Float32Array | null): void;
  addTile(view: TileView): void;
  removeTile(key: string): void;
  tiles(): ReadonlyMap<string, TileView>;
  /** Camera target in the input frame. */
  target(): Vec2;
  setShadows(on: boolean): void;
  setFog(on: boolean): void;
  applyTheme(): void;
  onCameraIdle(listener: () => void): void;
  renderStats(): RenderStats;
}

const ROAD_Y: Record<MapRoad['kind'], number> = { road: 0.03, rail: 0.05, path: 0.07 };

export function createScene(container: HTMLElement): SceneView {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 1, 30000);
  camera.position.set(300, 300, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false; // pan along the ground like a map
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 5;
  controls.maxDistance = 6000;
  controls.zoomToCursor = true;

  const hemi = new HemisphereLight(0xdfeaff, 0x6b6255, 1.5);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  const groundMaterial = new MeshLambertMaterial({ color: 0x9aa58c });
  const ground = new Mesh(new PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMaterial = new MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  let roadMesh: Mesh | null = null;
  let roads: readonly RoadLine[] = [];

  const treeGeometry = createTreeGeometry();
  const treeMaterial = new MeshLambertMaterial({ vertexColors: true });
  let treeMesh: InstancedMesh | null = null;

  const buildingMaterial = createBuildingMaterial();
  const tileGroup = new Group();
  const overlays = new Group();
  scene.add(tileGroup, overlays);
  const tileViews = new Map<string, TileView>();

  let extent: Extent = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  let fogOn = false;

  function roadColours(): Record<MapRoad['kind'], Rgb> {
    return {
      road: hexToRgb(cssVar('--scene-road'), [138, 141, 145]),
      path: hexToRgb(cssVar('--scene-path'), [201, 185, 154]),
      rail: hexToRgb(cssVar('--scene-rail'), [107, 91, 83]),
    };
  }

  function rebuildRoads(): void {
    if (roadMesh) {
      scene.remove(roadMesh);
      roadMesh.geometry.dispose();
      roadMesh = null;
    }
    if (roads.length === 0) return;
    const colours = roadColours();
    const strips: Strip[] = roads.map((r) => ({
      line: r.line,
      width: r.width,
      colour: colours[r.kind],
      y: ROAD_Y[r.kind],
    }));
    roadMesh = new Mesh(stripGeometry(strips), roadMaterial);
    roadMesh.receiveShadow = true;
    roadMesh.name = 'roads';
    scene.add(roadMesh);
  }

  function updateFog(): void {
    const size = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY, 200);
    scene.fog = fogOn ? new Fog(scene.background as Color, size * 0.6, size * 2.5) : null;
  }

  function placeSun(): void {
    const cx = (extent.minX + extent.maxX) / 2;
    const cy = (extent.minY + extent.maxY) / 2;
    const radius = Math.max(Math.hypot(extent.maxX - extent.minX, extent.maxY - extent.minY) / 2, 50);
    const centre = new Vector3(cx, 0, -cy);
    sun.target.position.copy(centre);
    sun.position.copy(centre).add(new Vector3(-0.5, 1, 0.6).normalize().multiplyScalar(radius * 3));
    const cam = sun.shadow.camera;
    cam.left = -radius * 1.1;
    cam.right = radius * 1.1;
    cam.top = radius * 1.1;
    cam.bottom = -radius * 1.1;
    cam.near = 1;
    cam.far = radius * 6;
    cam.updateProjectionMatrix();
  }

  function applyTheme(): void {
    scene.background = new Color(cssVar('--scene-sky') || '#cfe0f0');
    groundMaterial.color.set(cssVar('--scene-ground') || '#9aa58c');
    rebuildRoads();
    updateFog();
  }

  function resize(): void {
    const w = container.clientWidth;
    const hgt = container.clientHeight;
    if (w === 0 || hgt === 0) return;
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  applyTheme();

  // Camera idle: fires once the camera has not changed (damping included) for a moment.
  const idleListeners: (() => void)[] = [];
  let idleTimer = 0;
  controls.addEventListener('change', () => {
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      for (const l of idleListeners) l();
    }, 400);
  });

  let frames = 0;
  let fps = 0;
  let fpsStart = performance.now();
  let calls = 0;
  let triangles = 0;
  const loop = (): void => {
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
    calls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
    frames++;
    const t = performance.now();
    if (t - fpsStart >= 1000) {
      fps = (frames * 1000) / (t - fpsStart);
      frames = 0;
      fpsStart = t;
    }
  };
  loop();

  function disposeTile(view: TileView): void {
    tileGroup.remove(view.mesh);
    (view.mesh.geometry as BufferGeometry).dispose();
  }

  return {
    camera,
    canvas: renderer.domElement,
    overlays,
    setArea(next) {
      extent = next;
      const w = next.maxX - next.minX;
      const hgt = next.maxY - next.minY;
      const margin = Math.max(w, hgt) * 0.5 + 200;
      ground.scale.set(w + margin * 2, hgt + margin * 2, 1);
      ground.position.set((next.minX + next.maxX) / 2, 0, -(next.minY + next.maxY) / 2);
      controls.maxDistance = Math.max(800, Math.max(w, hgt) * 4);
      camera.far = controls.maxDistance * 4;
      camera.updateProjectionMatrix();
      placeSun();
      updateFog();
    },
    fit(e) {
      const centre = new Vector3((e.minX + e.maxX) / 2, 0, -(e.minY + e.maxY) / 2);
      const radius = Math.max(Math.hypot(e.maxX - e.minX, e.maxY - e.minY) / 2, 30);
      const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.85;
      // From the south-east and above: output Z points south.
      camera.position.copy(centre).add(new Vector3(0.35, 0.75, 0.6).normalize().multiplyScalar(distance));
      controls.target.copy(centre);
      controls.update();
    },
    focus([x, y], radius) {
      const target = new Vector3(x, 0, -y);
      const dir = camera.position.clone().sub(controls.target).normalize();
      const distance = Math.max(radius * 3, 25);
      controls.target.copy(target);
      camera.position.copy(target).add(dir.multiplyScalar(distance));
      controls.update();
    },
    setRoads(next) {
      roads = next;
      rebuildRoads();
    },
    setTrees(points) {
      if (treeMesh) {
        scene.remove(treeMesh);
        treeMesh.dispose();
        treeMesh = null;
      }
      const count = points ? Math.floor(points.length / 3) : 0;
      if (!points || count === 0) return;
      const mesh = new InstancedMesh(treeGeometry, treeMaterial, count);
      const m = new Matrix4();
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const p = new Vector3();
      const sc = new Vector3();
      const c = new Color();
      for (let i = 0; i < count; i++) {
        const x = points[i * 3] as number;
        const y = points[i * 3 + 1] as number;
        const k = points[i * 3 + 2] as number;
        // Rotation, height and tint vary with the position so the look is stable across rebuilds.
        const v = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        q.setFromAxisAngle(up, v * Math.PI * 2);
        p.set(x, 0, -y);
        sc.set(k, k * (0.85 + v * 0.4), k);
        mesh.setMatrixAt(i, m.compose(p, q, sc));
        mesh.setColorAt(i, c.setHSL(0.24 + v * 0.06, 0.45, 0.85 + v * 0.15));
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.name = 'trees';
      treeMesh = mesh;
      scene.add(mesh);
    },
    addTile(view) {
      const old = tileViews.get(view.key);
      if (old) disposeTile(old);
      view.mesh.material = buildingMaterial;
      view.mesh.castShadow = true;
      view.mesh.receiveShadow = true;
      view.mesh.name = `tile ${view.key}`;
      tileViews.set(view.key, view);
      tileGroup.add(view.mesh);
    },
    removeTile(key) {
      const old = tileViews.get(key);
      if (!old) return;
      disposeTile(old);
      tileViews.delete(key);
    },
    tiles: () => tileViews,
    target: () => [controls.target.x, -controls.target.z],
    setShadows(on) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      for (const m of [buildingMaterial, groundMaterial, roadMaterial, treeMaterial] as Material[])
        m.needsUpdate = true;
    },
    setFog(on) {
      fogOn = on;
      updateFog();
    },
    applyTheme,
    onCameraIdle(listener) {
      idleListeners.push(listener);
    },
    renderStats: () => ({ calls, triangles, fps }),
  };
}

/** Low-poly tree about 8 m tall: trunk, faceted crown and a small cone on top. */
function createTreeGeometry(): BufferGeometry {
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
