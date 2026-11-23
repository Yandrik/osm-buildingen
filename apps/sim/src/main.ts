import { createGeneratorPool } from '@osm-buildingen/three';
import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CameraRigController } from './camera';
import { Input } from './input';
import { PLACES } from './places';
import { OutlinePass, toon } from './render/toon';
import { setupTouch } from './touch';
import { Plane, type Vehicle, type VehicleKind, createVehicles } from './vehicles/vehicles';
import { TILE, X0, X1, Y0, Y1, lonLatToWorld, worldToLonLat } from './world/frame';
import { World } from './world/world';

const params = new URLSearchParams(location.search);
const mobile = window.matchMedia('(pointer: coarse)').matches || params.has('mobile');

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({
  canvas,
  antialias: false,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
const pixelRatio = Math.min(window.devicePixelRatio, mobile ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = !mobile;
renderer.info.autoReset = false;
renderer.shadowMap.type = PCFShadowMap;

const SKY = new Color('#a8daf7');
const scene = new Scene();
scene.background = SKY;
scene.fog = new Fog(SKY, 900, 5200);

const camera = new PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 40000);
scene.add(camera);

const hemi = new HemisphereLight('#e4f2ff', '#8a9a62', 1.1);
scene.add(hemi);
const sun = new DirectionalLight('#fff4dc', 2.4);
const sunDir = new Vector3(-0.45, 0.8, 0.4).normalize();
sun.castShadow = !mobile;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1400;
sun.shadow.bias = -0.00005;
sun.shadow.normalBias = 0.12;
const shadowBasis = {
  right: new Vector3().crossVectors(new Vector3(0, 1, 0), sunDir).normalize(),
  up: new Vector3(),
};
shadowBasis.up.crossVectors(sunDir, shadowBasis.right).normalize();
let shadowExtent = 0;
scene.add(sun, sun.target);

scene.add(clouds());

const outline = new OutlinePass(
  Math.floor(window.innerWidth * pixelRatio),
  Math.floor(window.innerHeight * pixelRatio),
  mobile ? 0 : 4,
  Math.max(1, Math.round(pixelRatio * 1.25)),
);

const pool = createGeneratorPool({
  createWorker: () =>
    new Worker(new URL('@osm-buildingen/three/worker', import.meta.url), { type: 'module' }),
  size: mobile ? 2 : Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 4)),
});
const world = new World(renderer, pool, { mobile });
scene.add(world.group);

// Building distance: ?bldg=metres, else the last value set in the help panel, else 350 m.
const BLDG_KEY = 'sim.buildingDistance';
const storedBldg = (() => {
  try {
    return localStorage.getItem(BLDG_KEY);
  } catch {
    return null;
  }
})();
const bldgParam = Number(params.get('bldg') ?? storedBldg ?? 350);
world.buildingDistance = Number.isFinite(bldgParam) ? Math.max(50, Math.min(5000, bldgParam)) : 350;

const HQ_KEY = 'sim.highQualityDistance';
const storedHq = (() => {
  try {
    return localStorage.getItem(HQ_KEY);
  } catch {
    return null;
  }
})();
const hqParam = Number(params.get('hq') ?? storedHq ?? 200);
world.buildings.highQualityDistance = Number.isFinite(hqParam) ? Math.max(50, Math.min(1000, hqParam)) : 200;

const input = new Input();
const touch = setupTouch(input, mobile);
const rig = new CameraRigController(camera);
const vehicles = createVehicles();
let vehicle: Vehicle = vehicles.car;

// Start position: URL ?at=lon,lat,bearing or the first place.
const start = (() => {
  const at = params.get('at')?.split(',').map(Number);
  if (at && at.length >= 2 && at.every(Number.isFinite)) {
    return { lon: at[0] as number, lat: at[1] as number, bearing: at[2] ?? 0 };
  }
  return PLACES[0] as (typeof PLACES)[number];
})();
const startWorld = lonLatToWorld(start.lon, start.lat);
let pendingPlace: { e: number; n: number; yaw: number; ground?: boolean } | null = {
  e: startWorld.e,
  n: startWorld.n,
  yaw: (-start.bearing * Math.PI) / 180,
};
const startKind = params.get('v');
if (startKind === 'bike' || startKind === 'car' || startKind === 'plane') vehicle = vehicles[startKind];
if (params.get('cam') === 'far') rig.mode = 'far';
if (params.get('cam') === 'cockpit') rig.mode = 'cockpit';
if (params.has('nooutline')) outline.enabled = false;
outline.debugView = Number(params.get('outlineDebug') ?? 0);
scene.add(vehicle.object);

// Prime the streamer around the start before anything else.
world.update(startWorld.e, startWorld.n, 0);

function switchVehicle(kind: VehicleKind): void {
  if (pendingPlace) {
    scene.remove(vehicle.object);
    vehicle = vehicles[kind];
    scene.add(vehicle.object);
    updateButtons();
    return;
  }
  const e = vehicle.position.x;
  const n = -vehicle.position.z;
  const yaw = vehicle.heading();
  scene.remove(vehicle.object);
  vehicle = vehicles[kind];
  scene.add(vehicle.object);
  vehicle.place(e, n, yaw, world);
  rig.snap();
  updateButtons();
}

function teleport(e: number, n: number, yaw: number, ground = false): void {
  pendingPlace = { e, n, yaw, ground };
  world.update(e, n, vehicle.kind === 'plane' ? 250 : 0);
}

// --- HUD -----------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const vehicleButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-vehicle]')];
function updateButtons(): void {
  for (const b of vehicleButtons) b.classList.toggle('active', b.dataset.vehicle === vehicle.kind);
  touch.setMode(vehicle.kind === 'plane');
}
for (const b of vehicleButtons) {
  b.addEventListener('click', () => {
    switchVehicle(b.dataset.vehicle as VehicleKind);
    b.blur();
  });
}
const places = $<HTMLSelectElement>('places');
places.add(new Option('Teleport…', ''));
PLACES.forEach((p, i) => places.add(new Option(p.name, String(i))));
places.addEventListener('change', () => {
  const p = PLACES[Number(places.value)];
  places.value = '';
  places.blur();
  if (!p) return;
  const w = lonLatToWorld(p.lon, p.lat);
  const ground = p.runway === true && vehicle.kind === 'plane';
  teleport(w.e, w.n, (-p.bearing * Math.PI) / 180, ground);
});
const help = $('help');
const toggleHelp = (): void => {
  help.hidden = !help.hidden;
  // The slider keeps focus otherwise and swallows the arrow keys.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};
$('help-btn').addEventListener('click', toggleHelp);
$('help-close').addEventListener('click', toggleHelp);
$('camera').addEventListener('click', () => rig.cycle());
$('reset').addEventListener('click', () => input.fire('reset'));
input.on('vehicle1', () => switchVehicle('bike'));
input.on('vehicle2', () => switchVehicle('car'));
input.on('vehicle3', () => switchVehicle('plane'));
input.on('camera', () => rig.cycle());
input.on('help', toggleHelp);
input.on('outline', () => {
  outline.enabled = !outline.enabled;
});
input.on('reset', () => {
  vehicle.place(vehicle.position.x, -vehicle.position.z, vehicle.heading(), world);
  rig.snap();
});
updateButtons();

const bldgInput = $<HTMLInputElement>('bldg');
const bldgValue = $('bldg-value');
bldgInput.value = String(world.buildingDistance);
bldgValue.textContent = `${world.buildingDistance} m`;
bldgInput.addEventListener('input', () => {
  world.buildingDistance = Number(bldgInput.value);
  bldgValue.textContent = `${bldgInput.value} m`;
  try {
    localStorage.setItem(BLDG_KEY, bldgInput.value);
  } catch {
    // Storage blocked (private mode): the setting just lasts for this session.
  }
});

const hqInput = $<HTMLInputElement>('hq');
const hqValue = $('hq-value');
hqInput.value = String(world.buildings.highQualityDistance);
hqValue.textContent = `${world.buildings.highQualityDistance} m`;
hqInput.addEventListener('input', () => {
  world.buildings.highQualityDistance = Number(hqInput.value);
  hqValue.textContent = `${hqInput.value} m`;
  try {
    localStorage.setItem(HQ_KEY, hqInput.value);
  } catch {
    // Storage blocked (private mode): the setting just lasts for this session.
  }
});

const speedEl = $('speed').querySelector('b') as HTMLElement;
const altEl = $('alt');
const statusEl = $('status');
const needle = $('needle');
const debugEl = $('debug');
const loadingEl = $('loading');
const showDebug = !mobile || params.has('debug');

function updateHud(fps: number): void {
  speedEl.textContent = String(Math.round(Math.abs(vehicle.speed) * 3.6));
  const ll = worldToLonLat(vehicle.position.x, -vehicle.position.z);
  altEl.textContent =
    vehicle.kind === 'plane'
      ? `alt ${Math.round(vehicle.position.y)} m · AGL ${Math.round(vehicle.clearance)} m · thr ${Math.round((vehicles.plane as Plane).throttle * 100)}%`
      : `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`;
  statusEl.textContent = vehicle.status;
  needle.style.transform = `rotate(${(vehicle.heading() * 180) / Math.PI}deg)`;
  touch.setThrottle((vehicles.plane as Plane).throttle);
  if (showDebug) {
    const b = world.buildings.stats;
    debugEl.textContent =
      `${fps.toFixed(0)} fps · tiles ${world.stats.tiles} (${world.stats.loading} loading)\n` +
      `cells ${b.cells} · massing ${b.massing} · full ${b.full} · gen ${b.pending}\n` +
      `${(b.triangles / 1e6).toFixed(2)}M bldg tris · ${(renderer.info.render.triangles / 1e6).toFixed(2)}M drawn · ${renderer.info.render.calls} calls`;
  }
}

// --- loop ----------------------------------------------------------------------------

let last = performance.now();
let streamTimer = 0;
let hudTimer = 0;
let frames = 0;
let fps = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;

  if (pendingPlace) {
    const ground = world.groundHeight(pendingPlace.e, pendingPlace.n);
    loadingEl.hidden = false;
    if (ground !== null && world.ready(pendingPlace.e, pendingPlace.n)) {
      if (pendingPlace.ground && vehicle instanceof Plane) {
        vehicle.placeOnGround(pendingPlace.e, pendingPlace.n, pendingPlace.yaw, world);
      } else {
        vehicle.place(pendingPlace.e, pendingPlace.n, pendingPlace.yaw, world);
      }
      pendingPlace = null;
      loadingEl.hidden = true;
      rig.snap();
    }
  } else {
    const controls = input.read();
    const steps = 2;
    for (let i = 0; i < steps; i++) vehicle.update(dt / steps, controls, world);
  }

  const e = pendingPlace ? pendingPlace.e : vehicle.position.x;
  const n = pendingPlace ? pendingPlace.n : -vehicle.position.z;
  streamTimer -= dt;
  if (streamTimer <= 0) {
    streamTimer = 0.2;
    const ground = world.groundHeight(e, n) ?? vehicle.position.y;
    world.update(e, n, Math.max(0, camera.position.y - ground));
  }

  rig.update(dt, vehicle, world);

  // Fog and outline range open up with altitude.
  const agl = Math.max(0, camera.position.y - (world.groundHeight(e, n) ?? 0));
  const fogFar = Math.min(14000, 5200 + agl * 12);
  (scene.fog as Fog).far = fogFar;
  (scene.fog as Fog).near = Math.min(4000, 900 + agl * 3);
  outline.fadeEnd = Math.min(5000, 1500 + agl * 4);

  updateShadow(agl);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    updateHud(fps);
  }
  renderer.info.reset();
  outline.render(renderer, scene, camera);
  requestAnimationFrame(frame);
}

/**
 * The shadow box covers the area in front of the camera, grows with altitude, and moves
 * in whole shadow-map texels so shadow edges do not crawl while driving.
 */
function updateShadow(agl: number): void {
  if (!sun.castShadow) return;
  const extent = Math.min(700, Math.round(70 + agl * 0.9));
  const cam = sun.shadow.camera;
  if (Math.abs(extent - shadowExtent) > 4) {
    shadowExtent = extent;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
  }
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  const focus = vehicle.position.clone().addScaledVector(forward.normalize(), shadowExtent * 0.45);
  // Centre on the ground, not on a plane flying high above it.
  focus.y = world.groundHeight(focus.x, -focus.z) ?? focus.y;
  const texel = (2 * shadowExtent) / sun.shadow.mapSize.x;
  const a = Math.round(focus.dot(shadowBasis.right) / texel) * texel;
  const b = Math.round(focus.dot(shadowBasis.up) / texel) * texel;
  const c = focus.dot(sunDir);
  focus
    .set(0, 0, 0)
    .addScaledVector(shadowBasis.right, a)
    .addScaledVector(shadowBasis.up, b)
    .addScaledVector(sunDir, c);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(sunDir, 700);
}

setInterval(() => {
  fps = frames;
  frames = 0;
}, 1000);

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outline.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
});

requestAnimationFrame(frame);

// Test hook for headless screenshots.
(window as unknown as { sim: unknown }).sim = {
  world,
  vehicles,
  get vehicle() {
    return vehicle;
  },
  camera,
  renderer,
};

function clouds(): Group {
  const group = new Group();
  const geometry = new IcosahedronGeometry(1, 1);
  const count = 260;
  const mesh = new InstancedMesh(geometry, toon({ color: '#ffffff', fog: false }), count * 4);
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  let k = 0;
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const w = (X1 - X0 + 1) * TILE;
  const h = (Y0 - Y1 + 1) * TILE;
  for (let i = 0; i < count; i++) {
    const cx = rand() * w;
    const cn = rand() * h;
    const cy = 1100 + rand() * 500;
    const size = 60 + rand() * 120;
    for (let j = 0; j < 4; j++) {
      p.set(cx + (rand() - 0.5) * size * 1.6, cy + rand() * size * 0.3, -(cn + (rand() - 0.5) * size));
      const r = size * (0.5 + rand() * 0.5);
      s.set(r, r * 0.55, r);
      m.compose(p, q, s);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
