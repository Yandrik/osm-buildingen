/** Low-poly vehicle models built from primitives. Forward is -Z, up is +Y, origin at ground level. */
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  type Object3D,
  TorusGeometry,
} from 'three';
import { toon } from '../render/toon';

function part(geometry: BufferGeometry, colour: string, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geometry, toon({ color: colour }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function wheel(radius: number, width: number, x: number, z: number): Mesh {
  const g = new CylinderGeometry(radius, radius, width, 10);
  g.rotateZ(Math.PI / 2);
  return part(g, '#26262a', x, radius, z);
}

export function carModel(): Group {
  const g = new Group();
  g.add(part(new BoxGeometry(1.85, 0.62, 4.3), '#d9382e', 0, 0.68, 0));
  g.add(part(new BoxGeometry(1.62, 0.58, 2.2), '#e8ecef', 0, 1.27, 0.25));
  g.add(part(new BoxGeometry(1.64, 0.44, 2.0), '#3a4d63', 0, 1.27, 0.25));
  g.add(part(new BoxGeometry(1.7, 0.18, 0.08), '#2b2b2b', 0, 0.5, -2.16));
  for (const x of [-0.62, 0.62]) {
    g.add(part(new BoxGeometry(0.34, 0.16, 0.06), '#fff3b0', x, 0.8, -2.16));
    g.add(part(new BoxGeometry(0.34, 0.14, 0.06), '#b3121b', x, 0.8, 2.16));
  }
  for (const [x, z] of [
    [-0.86, -1.35],
    [0.86, -1.35],
    [-0.86, 1.35],
    [0.86, 1.35],
  ] as const) {
    g.add(wheel(0.36, 0.28, x, z));
  }
  return g;
}

export function bikeModel(): { root: Group; lean: Group } {
  const root = new Group();
  const lean = new Group();
  root.add(lean);
  for (const z of [-0.55, 0.55]) {
    const t = new TorusGeometry(0.34, 0.045, 6, 16);
    t.rotateY(Math.PI / 2);
    lean.add(part(t, '#222222', 0, 0.36, z));
  }
  const frame = '#1f8fd6';
  const bar = (len: number, x: number, y: number, z: number, rx: number): void => {
    const m = part(new BoxGeometry(0.05, 0.05, len), frame, x, y, z);
    m.rotation.x = rx;
    lean.add(m);
  };
  bar(0.75, 0, 0.62, -0.05, -0.35);
  bar(0.62, 0, 0.5, 0.25, 0.9);
  bar(0.55, 0, 0.36, 0.3, 0);
  bar(0.62, 0, 0.62, -0.45, 1.25);
  lean.add(part(new BoxGeometry(0.5, 0.04, 0.04), '#333333', 0, 0.98, -0.5));
  // Rider.
  const torso = part(new BoxGeometry(0.36, 0.62, 0.24), '#f2c230', 0, 1.25, -0.05);
  torso.rotation.x = -0.55;
  lean.add(torso);
  lean.add(part(new IcosahedronGeometry(0.13, 1), '#e8b996', 0, 1.62, -0.28));
  lean.add(part(new IcosahedronGeometry(0.15, 0), '#d9382e', 0, 1.7, -0.27));
  for (const x of [-0.11, 0.11]) {
    const leg = part(new BoxGeometry(0.12, 0.62, 0.12), '#2d3a4f', x, 0.72, 0.08);
    leg.rotation.x = 0.35 * (x > 0 ? 1 : -1);
    lean.add(leg);
    const arm = part(new BoxGeometry(0.09, 0.5, 0.09), '#f2c230', x * 2.2, 1.2, -0.35);
    arm.rotation.x = -1.0;
    lean.add(arm);
  }
  return { root, lean };
}

export function planeModel(): { root: Group; prop: Object3D } {
  const root = new Group();
  const body = new CylinderGeometry(0.35, 0.62, 7, 8);
  body.rotateX(Math.PI / 2);
  root.add(part(body, '#f4f1ea', 0, 0, 0.3));
  const nose = new CylinderGeometry(0.62, 0.45, 0.8, 8);
  nose.rotateX(Math.PI / 2);
  root.add(part(nose, '#d9382e', 0, 0, -3.6));
  root.add(part(new BoxGeometry(10.5, 0.14, 1.6), '#f4f1ea', 0, 0.35, -0.6));
  root.add(part(new BoxGeometry(10.6, 0.15, 0.35), '#d9382e', 0, 0.36, -1.25));
  root.add(part(new BoxGeometry(3.6, 0.1, 0.9), '#f4f1ea', 0, 0.15, 3.3));
  root.add(part(new BoxGeometry(0.1, 1.4, 1.1), '#d9382e', 0, 0.8, 3.3));
  const canopy = part(new IcosahedronGeometry(0.55, 1), '#3a4d63', 0, 0.5, -1.1);
  canopy.scale.set(0.9, 0.7, 1.8);
  root.add(canopy);
  // Landing gear.
  for (const x of [-1.1, 1.1]) {
    root.add(part(new BoxGeometry(0.08, 0.9, 0.08), '#444444', x, -0.85, -0.6));
    const w = new CylinderGeometry(0.3, 0.3, 0.18, 10);
    w.rotateZ(Math.PI / 2);
    root.add(part(w, '#26262a', x, -1.3, -0.6));
  }
  const prop = new Group();
  prop.position.set(0, 0, -4.05);
  prop.add(part(new BoxGeometry(2.2, 0.16, 0.05), '#333333'));
  prop.add(part(new BoxGeometry(0.16, 2.2, 0.05), '#333333'));
  root.add(prop);
  return { root, prop };
}
