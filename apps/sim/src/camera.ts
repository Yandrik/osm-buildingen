import { type PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Vehicle } from './vehicles/vehicles';
import type { World } from './world/world';

export type CameraMode = 'chase' | 'far' | 'cockpit';
const MODES: CameraMode[] = ['chase', 'far', 'cockpit'];

/** Smoothed chase camera that never dips under the terrain. */
export class CameraRigController {
  mode: CameraMode = 'chase';
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private readonly back = new Vector3();
  private readonly tmp = new Vector3();
  private readonly q = new Quaternion();
  private snapped = false;

  constructor(private readonly camera: PerspectiveCamera) {}

  cycle(): CameraMode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length] as CameraMode;
    this.snapped = false;
    return this.mode;
  }

  snap(): void {
    this.snapped = false;
  }

  update(dt: number, v: Vehicle, world: World): void {
    const cam = this.camera;
    if (this.mode === 'cockpit') {
      this.tmp.copy(v.rig.eye).applyQuaternion(v.quaternion).add(v.position);
      cam.position.copy(this.tmp);
      // Ground vehicles: follow heading and slope but not every bump of the roll.
      cam.quaternion.copy(v.quaternion);
      this.snapped = false;
      return;
    }
    const far = this.mode === 'far' ? 2.2 : 1;
    const dist = v.rig.distance * far;
    const height = v.rig.height * far;
    if (v.kind === 'plane') {
      this.back.set(0, 0, 1).applyQuaternion(v.quaternion);
      this.back.y = this.back.y * 0.6;
      this.back.normalize();
    } else {
      const yaw = v.heading();
      this.back.set(Math.sin(yaw), 0, Math.cos(yaw));
    }
    const target = this.tmp.copy(v.position).addScaledVector(this.back, dist);
    target.y += height;
    if (!this.snapped) {
      this.pos.copy(target);
      this.snapped = true;
    } else {
      const k = 1 - Math.exp(-dt * (v.kind === 'plane' ? 5 : 7));
      this.pos.lerp(target, k);
    }
    const ground = world.groundHeight(this.pos.x, -this.pos.z);
    if (ground !== null && this.pos.y < ground + 1.2) this.pos.y = ground + 1.2;
    cam.position.copy(this.pos);
    this.look.copy(v.position);
    this.look.y += v.kind === 'plane' ? 1.5 : v.rig.height * 0.4;
    if (v.kind === 'plane') {
      cam.up.set(0, 1, 0).applyQuaternion(this.q.slerp(v.quaternion, Math.min(1, dt * 3)));
      cam.up.lerp(new Vector3(0, 1, 0), 0.6).normalize();
    } else {
      cam.up.set(0, 1, 0);
    }
    cam.lookAt(this.look);
  }
}
