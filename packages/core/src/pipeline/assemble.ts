import { shade } from '../colour';
import { offsetRing } from '../geom/polygon';
import type { Vec2 } from '../geom/vec2';
import { MeshBuilder } from '../mesh/builder';
import type { Frame } from '../mesh/frame';
import { PIECES, type PieceContext } from '../pieces';
import { arch } from '../pieces/arch';
import { seedFrom } from '../rng';
import { getStylePack } from '../styles/registry';
import type { FacadeTile } from '../styles/types';
import type {
  BuildingMesh,
  FacadeLayout,
  ResolvedSpec,
  RoofGeometry,
  Vec3,
  Vec3In,
  WallContext,
  WallSegment,
} from '../types';
import { addRoofDetails } from './roofDetails';

/** Thickness of the roof slab where it overhangs. */
const ROOF_THICKNESS = 0.16;
const PARAPET_WIDTH = 0.25;

/**
 * Stage 6. Turns walls, facade cells and roof faces into mesh buffers.
 * See plan/pipeline/06-mesh.md.
 */
export function assemble(
  spec: ResolvedSpec,
  walls: WallSegment[],
  roof: RoofGeometry,
  context: WallContext[],
  facade: FacadeLayout | null,
  baseElevation: number,
  seed: string | number,
): BuildingMesh {
  const mb = new MeshBuilder();
  const ground = baseElevation + spec.base;
  const eave = ground + spec.wallHeight;
  /** Footprint point + height above the wall base -> output space. */
  const world = (p: Vec2, h: number): Vec3 => [p[0], ground + h, -p[1]];
  const worldAbs = (p: Vec3In): Vec3 => [p[0], baseElevation + p[2], -p[1]];
  const { palette } = spec;

  // --- Walls ---
  const tiles = new Map<string, FacadeTile>();
  if (facade) for (const t of getStylePack(spec.packId).types[spec.type].tiles) tiles.set(t.id, t);

  const wallFrame = (wall: WallSegment, x: number, y: number, width: number, height: number): Frame => ({
    origin: world([wall.a[0] + wall.dir[0] * x, wall.a[1] + wall.dir[1] * x], y),
    right: [wall.dir[0], 0, -wall.dir[1]],
    up: [0, 1, 0],
    normal: [wall.normal[0], 0, -wall.normal[1]],
    width,
    height,
  });

  if (facade) {
    for (const cell of facade.cells) {
      const wall = walls[cell.wall] as WallSegment;
      const tile = tiles.get(cell.tile);
      const piece = (tile && PIECES[tile.piece]) ?? PIECES.wall;
      const timber = spec.wallStyle === 'timber' && cell.row >= spec.wallStyleFromLevel && wall.length >= 1.2;
      const ctx: PieceContext = {
        params: tile?.params ?? {},
        palette,
        wall: palette.wall,
        plinth: cell.row === 0 && spec.base < 0.5 ? Math.min(spec.plinthHeight, cell.height * 0.4) : 0,
        timber,
        era: spec.era,
        seed: seedFrom(seed, cell.wall, cell.row, cell.column),
      };
      const frame = wallFrame(wall, cell.x, cell.y, cell.width, cell.height);
      if (cell.role === 'arch') arch(mb, frame, { ...ctx, params: cell.params ?? {}, timber: false });
      else piece?.(mb, frame, ctx);
    }
  } else {
    for (const wall of walls) {
      mb.quad(
        world(wall.a, 0),
        world(wall.b, 0),
        world(wall.b, spec.wallHeight),
        world(wall.a, spec.wallHeight),
        palette.wall,
      );
    }
  }

  // Wall above the eave line: gable ends and the high sides under a skillion roof.
  for (const wall of walls) {
    if (wall.top.length < 2) continue;
    const pts: Vec3[] = [world(wall.a, spec.wallHeight), world(wall.b, spec.wallHeight)];
    for (let i = wall.top.length - 1; i >= 0; i--) {
      const p = wall.top[i] as { t: number; h: number };
      if (p.h < 1e-3 && (i === 0 || i === wall.top.length - 1)) continue; // coincides with the eave corner
      pts.push(
        world(
          [wall.a[0] + (wall.b[0] - wall.a[0]) * p.t, wall.a[1] + (wall.b[1] - wall.a[1]) * p.t],
          spec.wallHeight + p.h,
        ),
      );
    }
    if (pts.length >= 3) mb.polygon(pts, palette.wall);
  }

  // --- Roof ---
  const roofSide = shade(palette.roof, 0.78);
  const slab = roof.outline.length >= 3 && spec.roof.overhang > 0;
  for (const face of roof.faces) {
    const pts = face.points.map(worldAbs);
    mb.polygon(
      pts,
      palette.roof,
      face.holes?.map((h) => h.map(worldAbs)),
    );
    if (slab && face.kind === 'slope') {
      // Underside, so the overhang is not see-through from below.
      const under = face.points
        .map((p): Vec3 => [p[0], baseElevation + p[2] - ROOF_THICKNESS, -p[1]])
        .reverse();
      mb.polygon(under, roofSide);
    }
  }
  if (slab) {
    const n = roof.outline.length;
    for (let i = 0; i < n; i++) {
      const a = roof.outline[i] as Vec3In;
      const b = roof.outline[(i + 1) % n] as Vec3In;
      mb.quad(
        [a[0], baseElevation + a[2] - ROOF_THICKNESS, -a[1]],
        [b[0], baseElevation + b[2] - ROOF_THICKNESS, -b[1]],
        worldAbs(b),
        worldAbs(a),
        roofSide,
      );
    }
  }

  // --- Parapet on flat roofs ---
  if (spec.roof.shape === 'flat' && spec.roof.parapet > 0.02) {
    const outer = spec.footprint.outer;
    const inner = offsetRing(outer, -Math.min(PARAPET_WIDTH, spec.metrics.box.halfWidth * 0.4));
    const top = spec.wallHeight + spec.roof.parapet;
    const cap = palette.trim;
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const oa = outer[i] as Vec2;
      const ob = outer[j] as Vec2;
      const ia = inner[i] as Vec2;
      const ib = inner[j] as Vec2;
      mb.quad(
        world(oa, spec.wallHeight),
        world(ob, spec.wallHeight),
        world(ob, top),
        world(oa, top),
        palette.wall,
      );
      mb.quad(world(oa, top), world(ob, top), world(ib, top), world(ia, top), cap);
      mb.quad(
        world(ib, spec.wallHeight),
        world(ia, spec.wallHeight),
        world(ia, top),
        world(ib, top),
        shade(palette.wall, 0.9),
      );
    }
  }

  if (facade) addRoofDetails({ mb, spec, walls, context, roof, baseElevation, seed });

  void eave;
  return mb.finish();
}
