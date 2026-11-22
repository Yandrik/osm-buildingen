import { shade } from '../colour';
import { cross } from '../geom/vec2';
import type { MeshBuilder } from '../mesh/builder';
import { type Frame, box } from '../mesh/frame';
import { Rng, seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import { evalCurve } from '../styles/types';
import type { ResolvedSpec, WallContext, WallSegment } from '../types';
import { GENERATOR_VERSION } from '../version';

const BAND = { below: 0.06, above: 0.1, depth: 0.07 };
const CORNICE = { height: 0.32, depth: 0.2, step: 0.14, stepDepth: 0.09 };

export interface TrimStage {
  mb: MeshBuilder;
  spec: ResolvedSpec;
  walls: WallSegment[];
  context: WallContext[];
  baseElevation: number;
  seed: string | number;
}

/** Stretches of the wall without a neighbour in front of it at height `y` (above the wall base). */
function freeStretches(wall: WallSegment, ctx: WallContext | undefined, y: number): [number, number][] {
  const cuts = (ctx?.blocked ?? [])
    .filter((s) => y < s.height && y >= (s.minHeight ?? 0))
    .map((s) => [s.from, s.to] as const)
    .sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [from, to] of [...cuts, [wall.length, wall.length] as const]) {
    if (from - at > 0.3) out.push([at, from]);
    at = Math.max(at, to);
  }
  return out;
}

/**
 * Horizontal trim on older buildings: a slim band at every level line and a cornice
 * under the eave or parapet (style `trim`). One box per wall stretch and line, so
 * the cost does not grow with the number of facade cells. Walls with a neighbour in
 * front of them and timber-framed buildings get none.
 */
export function addTrim(stage: TrimStage): void {
  const { mb, spec, walls, context, baseElevation } = stage;
  const style = getStylePack(spec.packId).types[spec.type].trim;
  if (!style || spec.wallStyle === 'timber') return;
  const rng = new Rng(seedFrom(GENERATOR_VERSION, 'trim', stage.seed));
  const bands = rng.fork('band').chance(evalCurve(style.band ?? 0, spec.era));
  const cornice = rng.fork('cornice').chance(evalCurve(style.cornice ?? 0, spec.era));
  if (!bands && !cornice) return;

  const ground = baseElevation + spec.base;
  const colour = spec.palette.trim;
  const side = shade(colour, 0.84);
  const lines: { y: number; kind: 'band' | 'cornice' }[] = [];
  if (bands) {
    let y = 0;
    for (let i = 0; i + 1 < spec.levelHeights.length; i++) {
      y += spec.levelHeights[i] as number;
      lines.push({ y, kind: 'band' });
    }
  }
  if (cornice && spec.wallHeight > 2) lines.push({ y: spec.wallHeight, kind: 'cornice' });

  const rings = new Map<number, WallSegment[]>();
  for (const w of walls) rings.set(w.ring, [...(rings.get(w.ring) ?? []), w]);

  walls.forEach((wall, w) => {
    if (wall.length < 1) return;
    const ring = rings.get(wall.ring) ?? [];
    const k = ring.indexOf(wall);
    const prev = ring[(k + ring.length - 1) % ring.length] as WallSegment;
    const next = ring[(k + 1) % ring.length] as WallSegment;
    // At outside corners the boxes run on by their depth so neighbouring walls' trim meets,
    // unless the other wall is a party wall (the trim would stick out over the neighbour).
    const near = (other: WallSegment, along: number): boolean =>
      (context[walls.indexOf(other)]?.blocked ?? []).some(
        (s) => s.from <= along + 0.3 && s.to >= along - 0.3,
      );
    const convexStart = cross(prev.dir, wall.dir) > 1e-6 && !near(prev, prev.length);
    const convexEnd = cross(wall.dir, next.dir) > 1e-6 && !near(next, 0);
    const frame: Frame = {
      origin: [wall.a[0], ground, -wall.a[1]],
      right: [wall.dir[0], 0, -wall.dir[1]],
      up: [0, 1, 0],
      normal: [wall.normal[0], 0, -wall.normal[1]],
      width: wall.length,
      height: spec.wallHeight,
    };
    for (const line of lines) {
      const probe = line.kind === 'cornice' ? line.y - 0.2 : line.y;
      for (const [from, to] of freeStretches(wall, context[w], probe)) {
        const depth = line.kind === 'cornice' ? CORNICE.depth : BAND.depth;
        const u0 = from - (from < 0.01 && convexStart ? depth : 0);
        const u1 = to + (to > wall.length - 0.01 && convexEnd ? depth : 0);
        if (line.kind === 'band') {
          box(mb, frame, u0, line.y - BAND.below, u1, line.y + BAND.above, 0, depth, colour, {}, side);
        } else {
          const y1 = line.y;
          const y0 = y1 - CORNICE.height;
          box(mb, frame, u0, y0, u1, y1, 0, depth, colour, {}, side);
          const s0 = from - (from < 0.01 && convexStart ? CORNICE.stepDepth : 0);
          const s1 = to + (to > wall.length - 0.01 && convexEnd ? CORNICE.stepDepth : 0);
          box(mb, frame, s0, y0 - CORNICE.step, s1, y0, 0, CORNICE.stepDepth, colour, { top: false }, side);
        }
      }
    }
  });
}
