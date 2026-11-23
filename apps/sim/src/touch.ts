import type { Input } from './input';

/** On-screen stick and pedals. Shown on coarse pointers or after the first touch. */
export function setupTouch(
  input: Input,
  force: boolean,
): {
  setMode: (plane: boolean) => void;
  setThrottle: (v: number) => void;
} {
  const root = document.getElementById('touch') as HTMLElement;
  const stick = document.getElementById('stick') as HTMLElement;
  const knob = document.getElementById('knob') as HTMLElement;
  const pedals = document.getElementById('pedals') as HTMLElement;
  const throttle = document.getElementById('throttle') as HTMLElement;
  const fill = document.getElementById('thr-fill') as HTMLElement;
  const t = input.touch;
  let plane = false;

  const show = (): void => {
    if (t.active) return;
    t.active = true;
    root.hidden = false;
    setMode(plane);
  };

  let stickId: number | null = null;
  const moveStick = (e: PointerEvent): void => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    // Small dead zone, then a softer curve for fine steering.
    const shape = (v: number): number =>
      (Math.sign(v) * Math.max(0, Math.abs(v) - 0.08) ** 1.3) / 0.92 ** 1.3;
    t.side = shape(dx);
    t.forward = plane ? shape(-dy) : 0;
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e);
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob.style.transform = '';
    t.side = 0;
    if (plane) t.forward = 0;
  };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);

  const pressed = new Set<string>();
  const apply = (): void => {
    if (!plane) t.forward = (pressed.has('gas') ? 1 : 0) - (pressed.has('brake') ? 1 : 0);
    t.boost = pressed.has('boost');
    t.throttle = (pressed.has('thr-up') ? 1 : 0) - (pressed.has('thr-down') ? 1 : 0);
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-touch]')) {
    const role = button.dataset.touch as string;
    button.addEventListener('pointerdown', (e) => {
      button.setPointerCapture(e.pointerId);
      pressed.add(role);
      button.classList.add('on');
      apply();
    });
    const up = (): void => {
      pressed.delete(role);
      button.classList.remove('on');
      apply();
    };
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const setMode = (isPlane: boolean): void => {
    plane = isPlane;
    pedals.hidden = isPlane;
    throttle.hidden = !isPlane;
    t.forward = 0;
    t.side = 0;
    t.throttle = 0;
  };
  if (force || window.matchMedia('(pointer: coarse)').matches) show();
  window.addEventListener('touchstart', show, { passive: true });

  return {
    setMode,
    setThrottle: (v) => {
      fill.style.height = `${Math.round(v * 100)}%`;
    },
  };
}
