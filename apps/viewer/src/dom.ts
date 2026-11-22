/** Tiny DOM helpers (copied from apps/studio/src/dom.ts; candidate for a shared UI package). */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  title?: string;
  /** Event handlers, e.g. `{ click: () => ... }`. */
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Partial<Record<'background' | 'color' | 'width' | 'height' | 'display', string>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      if (v === undefined || v === false) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (props.style) Object.assign(el.style, props.style);
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      el.addEventListener(type, handler as EventListener);
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(
      typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c,
    );
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

/** Reads a CSS custom property from :root, e.g. for the three.js background. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const hex = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** Rounds for display, dropping trailing zeros. */
export const fmt = (n: number, digits = 2): string =>
  Number.isFinite(n) ? String(Number(n.toFixed(digits))) : String(n);
