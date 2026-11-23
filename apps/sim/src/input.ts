/**
 * Keyboard and touch input folded into one control state. Axes are -1..1.
 *
 * Ground vehicles: throttle (W/up), brake/reverse (S/down), steer (A/D, left/right).
 * Plane: pitch (W/S or up/down; S pulls up), roll (A/D), yaw (Q/E), throttle (Shift / Ctrl).
 */
export interface Controls {
  /** Forward (+) / back (-): gas and brake for ground vehicles, nose down / up for the plane. */
  forward: number;
  /** Right (+) / left (-). */
  side: number;
  /** Rudder for the plane. */
  yaw: number;
  /** Plane throttle change (+ up, - down). */
  throttle: number;
  boost: boolean;
  handbrake: boolean;
}

type Action = 'vehicle1' | 'vehicle2' | 'vehicle3' | 'camera' | 'reset' | 'help' | 'outline';

export class Input {
  private readonly keys = new Set<string>();
  readonly touch = { forward: 0, side: 0, throttle: 0, boost: false, handbrake: false, active: false };
  private readonly listeners = new Map<Action, () => void>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!e.repeat) this.action(e.code);
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(action: Action, fn: () => void): void {
    this.listeners.set(action, fn);
  }

  private action(code: string): void {
    const map: Record<string, Action> = {
      Digit1: 'vehicle1',
      Digit2: 'vehicle2',
      Digit3: 'vehicle3',
      KeyC: 'camera',
      KeyR: 'reset',
      KeyH: 'help',
      KeyO: 'outline',
    };
    const a = map[code];
    if (a) this.listeners.get(a)?.();
  }

  fire(action: Action): void {
    this.listeners.get(action)?.();
  }

  read(): Controls {
    const k = (...codes: string[]): number => (codes.some((c) => this.keys.has(c)) ? 1 : 0);
    const kb: Controls = {
      forward: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      side: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      yaw: k('KeyE') - k('KeyQ'),
      throttle: k('ShiftLeft', 'ShiftRight') - k('ControlLeft', 'ControlRight', 'KeyZ'),
      boost: k('ShiftLeft', 'ShiftRight') === 1,
      handbrake: k('Space') === 1,
    };
    const t = this.touch;
    return {
      forward: clamp(kb.forward + t.forward),
      side: clamp(kb.side + t.side),
      yaw: kb.yaw,
      throttle: clamp(kb.throttle + t.throttle),
      boost: kb.boost || t.boost,
      handbrake: kb.handbrake || t.handbrake,
    };
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
