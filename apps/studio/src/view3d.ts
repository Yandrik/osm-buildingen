/**
 * The 3D view. It only consumes `BuildingMesh` values: the building itself and optional
 * context meshes (neighbours, generated as massing by main.ts) drawn as grey ghosts.
 */
import type { BuildingMesh } from '@osm-buildingen/core';
import { createBuildingMaterial, toBufferGeometry } from '@osm-buildingen/three';
import {
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { cssVar } from './dom';

export interface View3d {
  /** Replaces the building. `null` keeps the scene empty. */
  setMesh(mesh: BuildingMesh | null): void;
  setContext(meshes: readonly BuildingMesh[]): void;
  setWireframe(on: boolean): void;
  /** Frames the building (or the origin when there is none). */
  fit(): void;
  exportGlb(): Promise<ArrayBuffer>;
  dispose(): void;
}

export function createView3d(container: HTMLElement): View3d {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 2000);
  camera.position.set(20, 16, 26);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the ground

  const hemi = new HemisphereLight(0xdfeaff, 0x6b6255, 1.6);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const groundMaterial = new MeshLambertMaterial({ color: 0x9aa58c });
  const ground = new Mesh(new PlaneGeometry(400, 400), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let grid = new GridHelper(100, 100);
  scene.add(grid);

  const buildingMaterial = createBuildingMaterial();
  const contextMaterial = new MeshLambertMaterial({
    color: 0x9a9a9a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const buildingGroup = new Group();
  const contextGroup = new Group();
  scene.add(buildingGroup, contextGroup);
  let building: Mesh | null = null;
  let hasFitted = false;

  function applyTheme(): void {
    scene.background = new Color(cssVar('--scene-sky') || '#cfe0f0');
    groundMaterial.color.set(cssVar('--scene-ground') || '#9aa58c');
    scene.remove(grid);
    grid.geometry.dispose();
    (grid.material as Material).dispose();
    const line = new Color(cssVar('--scene-grid') || '#808080');
    grid = new GridHelper(100, 100, line, line);
    grid.position.y = 0.01; // avoid z-fighting with the ground
    (grid.material as Material).transparent = true;
    (grid.material as Material).opacity = 0.35;
    scene.add(grid);
  }
  applyTheme();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', applyTheme);

  function disposeChildren(group: Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof Mesh) child.geometry.dispose();
    }
  }

  function bounds(): Box3 | null {
    return building ? new Box3().setFromObject(building) : null;
  }

  /** Shadow camera follows the building so the map resolution is spent where it matters. */
  function placeSun(): void {
    const box = bounds();
    const centre = box ? box.getCenter(new Vector3()) : new Vector3();
    const radius = box ? Math.max(box.getSize(new Vector3()).length() / 2, 5) : 20;
    const extent = radius * 2.5;
    sun.target.position.copy(centre);
    sun.position.copy(centre).add(new Vector3(-0.5, 1, 0.6).normalize().multiplyScalar(radius * 4));
    const cam = sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 0.1;
    cam.far = radius * 10;
    cam.updateProjectionMatrix();
  }

  function fit(): void {
    const box = bounds();
    const centre = box ? box.getCenter(new Vector3()) : new Vector3();
    const radius = box ? Math.max(box.getSize(new Vector3()).length() / 2, 3) : 15;
    const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.1;
    // From the south-east and above: output Z points south, so +Z looks north.
    camera.position.copy(centre).add(new Vector3(0.55, 0.5, 0.9).normalize().multiplyScalar(distance));
    controls.target.copy(centre);
    controls.update();
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

  let frame = 0;
  const loop = (): void => {
    frame = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  };
  loop();

  return {
    setMesh(mesh) {
      disposeChildren(buildingGroup);
      building = null;
      if (mesh) {
        building = new Mesh(toBufferGeometry(mesh), buildingMaterial);
        building.castShadow = true;
        building.receiveShadow = true;
        building.name = 'building';
        buildingGroup.add(building);
      }
      placeSun();
      if (!hasFitted && mesh) {
        fit();
        hasFitted = true;
      }
    },
    setContext(meshes) {
      disposeChildren(contextGroup);
      for (const m of meshes) {
        const ghost = new Mesh(toBufferGeometry(m), contextMaterial);
        ghost.receiveShadow = true;
        contextGroup.add(ghost);
      }
    },
    setWireframe(on) {
      (buildingMaterial as MeshLambertMaterial).wireframe = on;
    },
    fit,
    async exportGlb() {
      if (!building) throw new Error('No mesh to export.');
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(building, { binary: true });
      if (!(result instanceof ArrayBuffer)) throw new Error('glTF exporter returned JSON instead of binary.');
      return result;
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', applyTheme);
      controls.dispose();
      renderer.dispose();
    },
  };
}
