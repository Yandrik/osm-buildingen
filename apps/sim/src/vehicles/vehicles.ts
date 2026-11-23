/**
 * Arcade physics. Positions are three.js (X east, Y up, Z south); the world queries take
 * east/north, so n = -z.
 */
import { Euler, type Group, type Object3D, Quaternion, Vector3 } from 'three';
import type { Controls } from '../input';
import type { World } from '../world/world';
import { bikeModel, carModel, planeModel } from './models';

const G = 9.81;

export type VehicleKind = 'bike' | 'car' | 'plane';

export interface CameraRig {
  distance: number;
  height: number;
  /** Eye position in the vehicle frame for the cockpit camera. */
  eye: Vector3;
}

export interface Vehicle {
  readonly kind: VehicleKind;
  readonly object: Object3D;
  readonly rig: CameraRig;
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  /** Metres per second along the direction of travel. */
  speed: number;
  /** Height above the surface below, metres. */
  clearance: number;
  /** Seconds left until the respawn after a crash, 0 when flying. */
  crashed: number;
  /** Shown on the HUD. */
  status: string;
  place(e: number, n: number, yaw: number, world: World): void;
  update(dt: number, c: Controls, world: World): void;
  /** Heading (yaw) in radians, 0 = north, counter-clockwise. */
  heading(): number;
}

interface GroundParams {
  maxSpeed: number;
  boostSpeed: number;
  accel: number;
  brake: number;
  reverse: number;
  steerMax: number;
  wheelbase: number;
  radius: number;
  length: number;
  width: number;
  drag: number;
  slope: number;
}

class GroundVehicle implements Vehicle {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  speed = 0;
  clearance = 0;
  crashed = 0;
  status = '';
  protected yaw = 0;
  protected pitch = 0;
  protected roll = 0;
  protected steer = 0;
  protected yawRate = 0;
  private vy = 0;
  private grounded = true;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(
    readonly kind: VehicleKind,
    readonly object: Group,
    readonly rig: CameraRig,
    private readonly p: GroundParams,
  ) {}

  heading(): number {
    return this.yaw;
  }

  place(e: number, n: number, yaw: number, world: World): void {
    const h0 = world.groundHeight(e, n) ?? 0;
    // Never start inside a building.
    for (let i = 0; i < 30; i++) {
      const push = world.collide(e, n, this.p.radius + 0.6, h0 + 0.3);
      if (!push) break;
      e += push.de * 1.05;
      n += push.dn * 1.05;
    }
    const h = world.surface(e, n, 1e4)?.height ?? world.groundHeight(e, n) ?? 0;
    this.position.set(e, h, -n);
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.grounded = true;
    this.sync();
  }

  update(dt: number, c: Controls, world: World): void {
    const p = this.p;
    const fe = -Math.sin(this.yaw);
    const fn = Math.cos(this.yaw);

    const max = c.boost ? p.boostSpeed : p.maxSpeed;
    if (this.grounded) {
      if (c.forward > 0) {
        if (this.speed < -0.5) this.speed += p.brake * c.forward * dt;
        else this.speed += p.accel * c.forward * Math.max(0, 1 - (this.speed / max) ** 2) * dt;
      } else if (c.forward < 0) {
        if (this.speed > 0.5) this.speed += p.brake * c.forward * dt;
        else this.speed = Math.max(-p.reverse, this.speed + p.accel * 0.6 * c.forward * dt);
      }
      if (c.handbrake)
        this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), p.brake * 1.4 * dt);
      // Rolling resistance and air drag.
      const loss = (0.25 + p.drag * this.speed * this.speed) * dt;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), loss);
      if (this.speed > max) this.speed -= Math.min(this.speed - max, p.brake * 0.3 * dt);

      const hf = world.surface(this.e + fe * p.length * 0.5, this.n + fn * p.length * 0.5, this.position.y);
      const hr = world.surface(this.e - fe * p.length * 0.5, this.n - fn * p.length * 0.5, this.position.y);
      if (hf && hr) {
        const slope = (hf.height - hr.height) / p.length;
        this.speed -= G * p.slope * Math.max(-0.5, Math.min(0.5, slope)) * dt;
      }
      // Parked: brakes hold the vehicle on a slope when nothing is pressed.
      if (c.forward === 0 && Math.abs(this.speed) < 1) this.speed = 0;
    }

    const target = (c.side * p.steerMax) / (1 + Math.abs(this.speed) / 14);
    this.steer += (target - this.steer) * Math.min(1, dt * 8);
    this.yawRate = this.grounded ? (this.speed / p.wheelbase) * Math.tan(this.steer) : 0;
    this.yaw -= this.yawRate * dt;

    const oldE = this.e;
    const oldN = this.n;
    let e = oldE + fe * this.speed * dt;
    let n = oldN + fn * this.speed * dt;

    const push = world.collide(e, n, p.radius, this.position.y + 0.3);
    if (push) {
      e += push.de;
      n += push.dn;
      const len = Math.hypot(push.de, push.dn) || 1;
      // How directly the motion runs into the wall (1 = head-on), forwards or in reverse.
      const into = (-Math.sign(this.speed) * (fe * push.de + fn * push.dn)) / len;
      if (into > 0.6 && Math.abs(this.speed) > 3) {
        this.speed *= -0.2;
      } else if (into > 0) {
        // Glancing hit: lose a little speed and turn to slide along the wall.
        this.speed *= Math.max(0, 1 - (into * 6 + 0.5) * dt);
        const te = -push.dn / len;
        const tn = push.de / len;
        const s = Math.sign(fe * te + fn * tn) * Math.sign(this.speed || 1);
        const along = Math.atan2(-te * s, tn * s);
        let diff = along - this.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.yaw += diff * Math.min(1, dt * 6);
      }
    }

    const surface = world.surface(e, n, this.position.y);
    if (!surface) {
      // Terrain is not loaded here yet: wait at the edge.
      this.speed = 0;
      this.status = 'loading terrain…';
      return;
    }
    this.status = surface.onBridge ? 'on bridge' : '';
    this.position.x = e;
    this.position.z = -n;
    if (this.grounded) {
      if (surface.height < this.position.y - 0.7) {
        this.grounded = false;
        this.vy = 0;
      } else {
        this.position.y = surface.height;
      }
    }
    if (!this.grounded) {
      this.vy -= G * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= surface.height) {
        this.position.y = surface.height;
        this.grounded = true;
        this.vy = 0;
      }
    }
    this.clearance = this.position.y - surface.height;

    if (this.grounded) {
      const half = p.length / 2;
      const w = p.width / 2;
      const re = Math.cos(this.yaw);
      const rn = Math.sin(this.yaw);
      const y = this.position.y;
      const at = (de: number, dn: number): number => world.surface(e + de, n + dn, y)?.height ?? y;
      const pitch = Math.atan2(at(fe * half, fn * half) - at(-fe * half, -fn * half), p.length);
      const roll = Math.atan2(at(re * w, rn * w) - at(-re * w, -rn * w), p.width);
      const k = Math.min(1, dt * 10);
      this.pitch += (pitch - this.pitch) * k;
      this.roll += (roll - this.roll) * k;
    }
    this.sync();
  }

  protected get e(): number {
    return this.position.x;
  }

  protected get n(): number {
    return -this.position.z;
  }

  protected sync(): void {
    this.euler.set(this.pitch, this.yaw, this.roll);
    this.quaternion.setFromEuler(this.euler);
    this.object.position.copy(this.position);
    this.object.quaternion.copy(this.quaternion);
  }
}

class Bike extends GroundVehicle {
  private lean = 0;

  constructor(
    private readonly leanGroup: Group,
    root: Group,
  ) {
    super(
      'bike',
      root,
      { distance: 5, height: 2.2, eye: new Vector3(0, 1.75, -0.2) },
      {
        maxSpeed: 9,
        boostSpeed: 14,
        accel: 2.6,
        brake: 6,
        reverse: 1.5,
        steerMax: 0.6,
        wheelbase: 1.1,
        radius: 0.45,
        length: 1.6,
        width: 0.5,
        drag: 0.004,
        slope: 1.0,
      },
    );
  }

  override update(dt: number, c: Controls, world: World): void {
    super.update(dt, c, world);
    const target = Math.max(-0.7, Math.min(0.7, Math.atan((this.speed * this.yawRate) / G)));
    this.lean += (target - this.lean) * Math.min(1, dt * 6);
    this.leanGroup.rotation.z = this.lean;
  }
}

export class Plane implements Vehicle {
  readonly kind = 'plane';
  readonly object: Group;
  readonly rig: CameraRig = { distance: 16, height: 4.5, eye: new Vector3(0, 0.85, -1.0) };
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  speed = 0;
  clearance = 0;
  crashed = 0;
  status = '';
  throttle = 0.6;
  private sink = 0;
  private grounded = false;
  private readonly prop: Object3D;
  private readonly tmp = new Quaternion();
  private readonly axis = new Vector3();
  private readonly fwd = new Vector3();
  private readonly right = new Vector3();

  static readonly STALL = 26;
  static readonly GEAR = 1.65;

  constructor() {
    const { root, prop } = planeModel();
    this.object = root;
    this.prop = prop;
  }

  heading(): number {
    this.fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    return Math.atan2(-this.fwd.x, -this.fwd.z);
  }

  place(e: number, n: number, yaw: number, world: World): void {
    const ground = world.groundHeight(e, n) ?? 0;
    this.position.set(e, ground + 250, -n);
    this.quaternion.setFromEuler(new Euler(0, yaw, 0, 'YXZ'));
    this.speed = 52;
    this.throttle = 0.65;
    this.sink = 0;
    this.grounded = false;
    this.crashed = 0;
    this.sync();
  }

  /** Puts the plane on the ground at the given spot, ready for take-off. */
  placeOnGround(e: number, n: number, yaw: number, world: World): void {
    this.place(e, n, yaw, world);
    const ground = world.surface(e, n, 1e4)?.height ?? 0;
    this.position.y = ground + Plane.GEAR;
    this.speed = 0;
    this.throttle = 0;
    this.grounded = true;
    this.sync();
  }

  update(dt: number, c: Controls, world: World): void {
    this.prop.rotation.z += dt * (8 + this.throttle * 60);
    if (this.crashed > 0) {
      this.crashed -= dt;
      this.status = 'CRASHED';
      if (this.crashed <= 0) this.place(this.position.x, -this.position.z, this.heading(), world);
      return;
    }
    this.throttle = Math.max(0, Math.min(1, this.throttle + c.throttle * 0.45 * dt));
    const q = this.quaternion;
    const fwd = this.fwd.set(0, 0, -1).applyQuaternion(q);
    const right = this.right.set(1, 0, 0).applyQuaternion(q);
    const eff = Math.max(0.15, Math.min(1, this.speed / 40));

    if (this.grounded) {
      this.groundRoll(dt, c, world, fwd);
    } else {
      // Pitch (S pulls up), roll and yaw in the plane's own frame.
      this.rotateLocal(1, 0, 0, -c.forward * 0.85 * eff * dt);
      this.rotateLocal(0, 0, 1, -c.side * 1.8 * eff * dt);
      this.rotateLocal(0, 1, 0, -c.yaw * 0.45 * eff * dt);
      // Coordinated turn: banking turns the plane like lift would.
      const bank = Math.asin(Math.max(-1, Math.min(1, -right.y)));
      const turn = (G * Math.tan(Math.max(-1.3, Math.min(1.3, bank)))) / Math.max(this.speed, 20);
      this.tmp.setFromAxisAngle(this.axis.set(0, 1, 0), -turn * dt * Math.cos(Math.asin(fwd.y)));
      q.premultiply(this.tmp);
      // Below stall speed the nose drops.
      const stall = Math.max(0, 1 - this.speed / Plane.STALL);
      if (stall > 0 && fwd.y > -0.7) this.rotateLocal(1, 0, 0, -stall * 0.8 * dt);
      q.normalize();
    }

    fwd.set(0, 0, -1).applyQuaternion(q);
    const thrust = this.throttle * 16 + (c.boost ? 6 : 0);
    const drag = 0.0032 * this.speed * this.speed;
    this.speed = Math.max(0, this.speed + (thrust - drag - G * fwd.y - (this.grounded ? 0.6 : 0)) * dt);
    const lift = Math.min(1, (this.speed / Plane.STALL) ** 2);
    const target = this.grounded ? 0 : -(1 - lift) * 30;
    this.sink += (target - this.sink) * Math.min(1, dt * 1.2);

    const dx = fwd.x * this.speed;
    const dy = fwd.y * this.speed + this.sink;
    const dz = fwd.z * this.speed;
    const e = this.position.x + dx * dt;
    const n = -(this.position.z + dz * dt);
    let y = this.position.y + dy * dt;

    const surface = world.surface(e, n, y - Plane.GEAR);
    if (!surface) {
      this.status = 'loading terrain…';
      return;
    }
    const floor = surface.height + Plane.GEAR;
    if (y <= floor) {
      const pitch = Math.asin(fwd.y);
      const bank = Math.asin(Math.max(-1, Math.min(1, -right.y)));
      const gentle = dy > -7 && Math.abs(bank) < 0.35 && pitch > -0.15 && pitch < 0.35;
      if (this.grounded || gentle) {
        y = floor;
        this.grounded = true;
        this.sink = 0;
      } else {
        this.crash();
        return;
      }
    } else if (this.grounded && y > floor + 0.3) {
      this.grounded = false;
    } else if (this.grounded) {
      y = floor;
    }
    if (world.insideBuilding(e, n, y)) {
      this.crash();
      return;
    }
    this.position.set(e, y, -n);
    this.clearance = y - floor;
    this.status = this.grounded ? (this.speed < 1 ? 'on the ground' : 'rolling') : '';
    if (!this.grounded && this.speed < Plane.STALL) this.status = 'STALL';
    this.sync();
  }

  private groundRoll(dt: number, c: Controls, world: World, fwd: Vector3): void {
    let yaw = Math.atan2(-fwd.x, -fwd.z);
    let pitch = Math.asin(fwd.y);
    yaw -= c.side * 0.7 * Math.min(1, this.speed / 8) * dt;
    if (c.handbrake || c.forward > 0) {
      this.speed -= Math.min(this.speed, 8 * dt * (c.handbrake ? 1 : 0.5));
    }
    // Rotate for take-off only once fast enough.
    const up = -c.forward;
    if (this.speed > Plane.STALL * 0.9 && up > 0) pitch = Math.min(0.3, pitch + up * 0.5 * dt);
    else pitch += (0 - pitch) * Math.min(1, dt * 3);
    const push = world.collide(this.position.x, -this.position.z, 4, this.position.y);
    if (push) this.speed *= 0.5;
    this.quaternion.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
  }

  private crash(): void {
    this.crashed = 2.5;
    this.speed = 0;
    this.sink = 0;
    this.status = 'CRASHED';
  }

  private rotateLocal(x: number, y: number, z: number, angle: number): void {
    this.tmp.setFromAxisAngle(this.axis.set(x, y, z), angle);
    this.quaternion.multiply(this.tmp);
  }

  private sync(): void {
    this.object.position.copy(this.position);
    this.object.quaternion.copy(this.quaternion);
  }
}

export function createVehicles(): Record<VehicleKind, Vehicle> {
  const bike = bikeModel();
  return {
    bike: new Bike(bike.lean, bike.root),
    car: new GroundVehicle(
      'car',
      carModel(),
      { distance: 9, height: 3.2, eye: new Vector3(-0.38, 1.35, 0.1) },
      {
        maxSpeed: 33,
        boostSpeed: 55,
        accel: 6.5,
        brake: 14,
        reverse: 8,
        steerMax: 0.55,
        wheelbase: 2.7,
        radius: 1.1,
        length: 4.2,
        width: 1.8,
        drag: 0.0012,
        slope: 0.6,
      },
    ),
    plane: new Plane(),
  };
}
