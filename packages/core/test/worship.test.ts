/**
 * Places of worship: part roles from mapped geometry, church windows and belfries,
 * and the tower or ridge turret of churches mapped without parts.
 * See plan/styles/worship.md.
 */
import { describe, expect, it } from 'vitest';
import { type BuildingDebug, type BuildingInput, type BuildingMesh, generateBuilding } from '../src';
import { centroid } from '../src/geom/polygon';
import { MeshBuilder } from '../src/mesh/builder';
import { window as windowPiece } from '../src/pieces/window';
import { straightEaves } from '../src/pipeline/roofs/eaves';
import { rect, rotate } from './shapes';

const church = (over: Partial<BuildingInput> = {}): BuildingInput => ({
  footprint: { outer: rect(20, 10) },
  type: 'worship',
  style: { region: 'de', modernity: 0.2 },
  seed: 'church',
  debug: true,
  ...over,
});

const partsOf = (mesh: BuildingMesh): BuildingDebug[] => mesh.debug?.parts ?? [];
const topOf = (d: BuildingDebug): number => d.spec.base + d.spec.wallHeight + d.spec.roof.height;
const tilesOf = (d: BuildingDebug, row?: number): string[] =>
  (d.facade?.cells ?? []).filter((c) => row === undefined || c.row === row).map((c) => c.tile);

/** Nave with a west tower and a pinnacle on the nave's eave, mapped as parts. */
const mapped = (over: Partial<BuildingInput> = {}): BuildingInput =>
  church({
    footprint: { outer: rect(30, 10) },
    height: 22,
    roof: { shape: 'gabled' },
    parts: [
      { footprint: { outer: rect(22, 10, 8, 0) }, height: 22, roof: { shape: 'gabled', height: 8 } },
      { footprint: { outer: rect(8, 10) }, height: 55, roof: { shape: 'pyramidal', height: 15 } },
      {
        footprint: { outer: rect(1, 1, 29, 0) },
        minHeight: 14,
        height: 19,
        roof: { shape: 'pyramidal', height: 3 },
      },
    ],
    ...over,
  });

describe('worship: mapped parts', () => {
  it('gives each part a role from its shape', () => {
    const parts = partsOf(generateBuilding(mapped()));
    expect(parts.map((p) => p.spec.volume)).toEqual(['main', 'tower', 'small']);
  });

  it('puts a belfry at the top of the tower and leaves small parts blank', () => {
    const [nave, tower, pinnacle] = partsOf(generateBuilding(mapped({ facadeVariant: 'gothic' })));
    if (!nave || !tower || !pinnacle) throw new Error('missing part');
    const top = tower.spec.levelHeights.length - 1;
    expect(top).toBeGreaterThan(0);
    expect(tilesOf(tower, top)).toContain('belfry_gothic');
    // Nothing may stand on a belfry: it only appears in the top row.
    for (let row = 0; row < top; row++) expect(tilesOf(tower, row)).not.toContain('belfry_gothic');
    expect(new Set(tilesOf(pinnacle))).toEqual(new Set(['blank']));
    expect(tilesOf(nave)).toContain('win_gothic');
    // The portal belongs to the west front, which here is the tower.
    expect(tilesOf(tower, 0)).toContain('portal_gothic');
    expect(tilesOf(nave).some((id) => id.startsWith('portal'))).toBe(false);
  });

  it('lays rows out by volume: one tall row on the nave, stages on the tower', () => {
    const [nave, tower, pinnacle] = partsOf(generateBuilding(mapped()));
    // 14 m of nave wall: one window per bay from floor to eaves.
    expect(nave?.spec.levelHeights).toEqual([14]);
    // 40 m of tower wall, 10 m wide: stages of about its width, 9 m at most.
    expect(tower?.spec.levelHeights.length).toBe(4);
    expect(pinnacle?.spec.levelHeights.length).toBe(1);
  });

  it('takes slim and very tall parts for buttresses, not towers', () => {
    const pier = (x: number, w: number, d: number, height: number) => ({
      footprint: { outer: rect(w, d, x, -d) },
      height,
      roof: { shape: 'pyramidal' as const, height: 4 },
    });
    const input = mapped();
    const parts = [...(input.parts ?? []), pier(12, 1.8, 3.6, 22), pier(18, 3, 3, 40)];
    const built = partsOf(generateBuilding({ ...input, parts }));
    // Oblong and under 2.5 m wide; and walls more than six times the side.
    expect(built[3]?.spec.volume).toBe('small');
    expect(built[4]?.spec.volume).toBe('small');
    // Stone like the walls, a shade darker, instead of the building's roof colour.
    expect(built[3]?.spec.palette.roof).toBe(built[3]?.spec.palette.wall);
    expect(built[3]?.spec.palette.wall).not.toBe(built[0]?.spec.palette.wall);
  });

  it('lays the bays of a wall out between the buttresses standing against it', () => {
    const buttress = (x: number) => ({
      footprint: { outer: rect(1.6, 2, x, -2) },
      height: 16,
      roof: { shape: 'pyramidal' as const, height: 3 },
    });
    const input = mapped({ facadeVariant: 'gothic' });
    const piers = [13, 20, 27].map((x) => buttress(x - 0.8));
    const nave = partsOf(generateBuilding({ ...input, parts: [...(input.parts ?? []), ...piers] }))[0];
    const south = (nave?.facade?.cells ?? []).filter((c) => c.wall === 0);
    // 22 m of wall from x = 8: three piers of 1.6 m and the four bays between and beside them.
    // (The piers come out a little wider than mapped: the wall is sampled every 25 cm.)
    [4.2, 1.6, 5.4, 1.6, 5.4, 1.6, 2.2].forEach((width, i) => {
      expect(Math.abs((south[i]?.width ?? 0) - width)).toBeLessThan(0.3);
    });
    expect(south.length).toBe(7);
    // The last bay is too slim to take a window between a pier and the corner.
    expect(south.map((c) => c.blocked)).toEqual([false, true, false, true, false, true, true]);
    expect(south.filter((c) => c.tile === 'win_gothic').length).toBe(3);
    // A bay beside a mapped pier, or beside the tower, gets no buttress of its own on that side.
    expect(south[0]?.params).toEqual({ edgeL: 0, edgeR: 0 });
    expect(south[2]?.params).toEqual({ edgeL: 0, edgeR: 0 });
  });

  it('keeps slits out of wide tower bays and doubles the belfry openings there', () => {
    const [, tower] = partsOf(generateBuilding(mapped({ facadeVariant: 'gothic' })));
    // Walls of 8 and 10 m are one bay each: lancets, not slits.
    expect(tilesOf(tower as BuildingDebug)).not.toContain('slit_round');
    const count = (width: number, twin: number): number => {
      const mb = new MeshBuilder();
      const frame = {
        origin: [0, 0, 0],
        right: [1, 0, 0],
        up: [0, 1, 0],
        normal: [0, 0, 1],
        width,
        height: 8,
      } as const;
      const palette = (tower as BuildingDebug).spec.palette;
      windowPiece(mb, frame, {
        params: { w: 0.44, h: 0.56, sill: 0.22, louvre: 1, twin },
        palette,
        wall: palette.wall,
        plinth: 0,
        timber: false,
        era: 0.2,
        seed: 0,
      });
      return mb.triangleCount;
    };
    expect(count(3, 1)).toBe(count(3, 0));
    expect(count(5, 1)).toBe(2 * count(2.5, 0));
    expect(count(7.5, 1)).toBe(3 * count(2.5, 0));
  });

  it('gives one tower the clock faces', () => {
    // Twin towers; with this seed the building has clocks.
    const twin = mapped({ seed: 'clock2' });
    const parts = [...(twin.parts ?? [])];
    parts.push({
      footprint: { outer: rect(7, 10, 30, 0) },
      height: 50,
      roof: { shape: 'pyramidal', height: 12 },
    });
    const built = partsOf(generateBuilding({ ...twin, footprint: { outer: rect(37, 10) }, parts }));
    const withClock = built.filter((p) => tilesOf(p).includes('clock'));
    expect(withClock.length).toBe(1);
    // The larger one, in the row below the belfry, at most one per wall.
    expect(withClock[0]).toBe(built[1]);
    const cells = (withClock[0]?.facade?.cells ?? []).filter((c) => c.tile === 'clock');
    const rows = withClock[0]?.spec.levelHeights.length ?? 0;
    expect(new Set(cells.map((c) => c.row))).toEqual(new Set([rows - 2]));
    expect(new Set(cells.map((c) => c.wall)).size).toBe(cells.length);
  });

  it('ends the body under a part mapped above the ground where that part begins', () => {
    // A porch at the west end, mapped only as its roof from 6 m up; the outline has no height.
    const input = church({
      footprint: { outer: rect(36, 12) },
      parts: [
        { footprint: { outer: rect(30, 12, 6, 0) }, height: 20, roof: { shape: 'gabled', height: 6 } },
        {
          footprint: { outer: rect(6, 12) },
          minHeight: 6,
          height: 9,
          roof: { shape: 'skillion', height: 1 },
        },
      ],
    });
    const body = partsOf(generateBuilding(input))[2];
    expect(body?.spec.base).toBe(0);
    expect(body?.spec.wallHeight).toBe(6);
    expect(body?.spec.roof.shape).toBe('flat');
  });

  it('softens a mapped black roof to anthracite', () => {
    const input = mapped();
    const parts = (input.parts ?? []).map((p, i) =>
      i === 0 ? { ...p, roof: { ...p.roof, colour: 'black' } } : p,
    );
    const nave = partsOf(generateBuilding({ ...input, parts }))[0];
    expect(nave?.spec.palette.roof).toBe(0x646a73);
  });

  it('follows the architecture given as facade variant', () => {
    for (const variant of ['romanesque', 'gothic', 'classic', 'modern']) {
      const [nave] = partsOf(generateBuilding(mapped({ facadeVariant: variant })));
      expect(nave?.spec.facadeVariant).toBe(variant);
      expect(tilesOf(nave as BuildingDebug)).toContain(`win_${variant}`);
    }
  });

  it('gives a tower mapped without a roof shape a pyramid', () => {
    const input = mapped();
    const parts = (input.parts ?? []).map((p, i) => (i === 1 ? { ...p, roof: undefined } : p));
    const tower = partsOf(generateBuilding({ ...input, parts }))[1];
    expect(tower?.spec.volume).toBe('tower');
    expect(tower?.spec.roof.shape).toBe('pyramidal');
  });

  it('ignores the level count: rows follow the wall height', () => {
    const one = partsOf(generateBuilding(mapped({ levels: 1 })));
    const many = partsOf(generateBuilding(mapped({ levels: 9 })));
    expect(one.map((p) => p.spec.levelHeights.length)).toEqual(many.map((p) => p.spec.levelHeights.length));
  });

  it('leaves the parts of other types alone', () => {
    const parts = partsOf(generateBuilding(mapped({ type: 'office' })));
    expect(parts.every((p) => p.spec.volume === 'main')).toBe(true);
  });
});

describe('worship: churches without parts', () => {
  it('gets a ridge turret that rises out of the roof', () => {
    const mesh = generateBuilding(church());
    const [turret, body] = partsOf(mesh);
    if (!turret || !body) throw new Error('missing part');
    const eave = body.spec.base + body.spec.wallHeight;
    const ridge = topOf(body);
    // Starts inside the roof, so no gap shows under it, and stands above the ridge.
    expect(turret.spec.base).toBeGreaterThan(eave);
    expect(turret.spec.base).toBeLessThan(ridge);
    expect(turret.spec.base + turret.spec.wallHeight).toBeGreaterThan(ridge);
    expect(turret.spec.volume).toBe('tower');
    // A finial stands on the tip.
    expect(mesh.bounds.max[1]).toBeGreaterThan(topOf(turret) + 0.5);
    expect(mesh.bounds.max[1]).toBeLessThan(topOf(turret) + 3.3);
  });

  it('sizes the walls from the width when no height is given', () => {
    const [, small] = partsOf(generateBuilding(church()));
    expect(small?.spec.wallHeight).toBeCloseTo(8, 3);
    expect(small?.spec.levelHeights.length).toBe(1);
  });

  it('keeps the steeple at massing detail', () => {
    for (const footprint of [rect(20, 10), rect(40, 16)]) {
      const full = partsOf(generateBuilding(church({ footprint: { outer: footprint } })));
      const massing = generateBuilding(church({ footprint: { outer: footprint }, detail: 'massing' }));
      // Same parts, and the massing mesh ends at the tip of the spire (the finial is detail).
      expect(partsOf(massing).length).toBe(full.length);
      expect(massing.bounds.max[1]).toBeCloseTo(Math.max(...full.map(topOf)), 3);
    }
  });

  it('puts the tower of a large church at the west end, or the south end', () => {
    for (const [degrees, west] of [
      [0, true],
      [180, true],
      [90, false],
      [-90, false],
    ] as const) {
      const outer = rotate(rect(40, 16, -20, -8), degrees);
      const parts = partsOf(generateBuilding(church({ footprint: { outer } })));
      const shaft = parts[0];
      const body = parts[parts.length - 1];
      if (!shaft || !body) throw new Error('missing part');
      expect(shaft.spec.volume).toBe('tower');
      expect(Math.max(...parts.map(topOf))).toBeGreaterThan(topOf(body) * 1.5);
      const t = centroid(shaft.spec.footprint.outer);
      const b = centroid(body.spec.footprint.outer);
      if (west) expect(t[0]).toBeLessThan(b[0] - 5);
      else expect(t[1]).toBeLessThan(b[1] - 5);
      // The portal is in the tower's front wall, which stands a little proud of the nave's.
      const portal = (shaft.facade?.cells ?? []).find((c) => c.role === 'door');
      expect(portal?.tile.startsWith('portal_')).toBe(true);
      const wall = shaft.walls[portal?.wall ?? 0];
      expect(west ? wall?.normal[0] : wall?.normal[1]).toBeLessThan(-0.9);
    }
  });

  it('builds the steeple its architecture asks for', () => {
    const large = { footprint: { outer: rect(40, 16) } };
    // Baroque: an octagonal stage under a bell roof with a lantern, drawn from a profile.
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const parts = partsOf(generateBuilding(church({ ...large, facadeVariant: 'classic', seed })));
      const top = parts[parts.length - 2];
      if (top?.spec.roof.shape !== 'onion') continue;
      expect(top.spec.footprint.outer.length).toBe(8);
      expect(top.spec.roof.profile?.length).toBeGreaterThan(8);
      return;
    }
    throw new Error('no baroque tower in six seeds');
  });

  it('may give a plain rectangle a polygonal east end under a hipped roof', () => {
    let seen = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const input = church({ seed, facadeVariant: 'romanesque', roof: { shape: 'gabled' } });
      const parts = partsOf(generateBuilding(input));
      const body = parts[parts.length - 1];
      if (!body || body.spec.footprint.outer.length !== 6) continue;
      seen++;
      // Inside the outline: the two east corners are cut off, nothing is added.
      for (const p of body.spec.footprint.outer) {
        expect(p[0]).toBeGreaterThan(-0.01);
        expect(p[0]).toBeLessThan(20.01);
      }
      expect(Math.max(...body.spec.footprint.outer.map((p) => p[0]))).toBeCloseTo(20, 2);
      // One gable, at the west end; the walls of the apse end at the eave.
      const gables = body.walls.filter((w) => w.top.length > 0);
      expect(gables.length).toBe(1);
      expect(gables[0]?.normal[0]).toBeLessThan(-0.9);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('follows the faith: onion and three-barred cross, or no steeple at all', () => {
    const orthodox = partsOf(generateBuilding(church({ faith: 'orthodox' })));
    expect(orthodox[0]?.spec.roof.shape).toBe('onion');
    expect(orthodox[0]?.spec.palette.roof).toBe(0xc9a227);
    expect(orthodox[0]?.spec.faith).toBe('orthodox');
    for (const faith of ['jewish', 'muslim', 'other'] as const)
      expect(partsOf(generateBuilding(church({ faith })))).toEqual([]);
  });

  it('adds nothing to odd shapes or roofs without a ridge', () => {
    const L = {
      outer: rect(20, 10)
        .slice(0, 2)
        .concat([
          [20, 4],
          [6, 4],
          [6, 20],
          [0, 20],
        ]),
    };
    expect(partsOf(generateBuilding(church({ footprint: L })))).toEqual([]);
    expect(partsOf(generateBuilding(church({ roof: { shape: 'dome' } })))).toEqual([]);
  });
});

describe('worship: roofs', () => {
  it('sweeps a given profile around the centre', () => {
    const bulb = [
      [1, 0],
      [1.5, 0.3],
      [0.5, 0.7],
      [0, 1],
    ] as const;
    const base = { footprint: { outer: rect(6, 6) }, height: 16, type: 'worship' as const, entrance: false };
    const plain = generateBuilding(church({ ...base, roof: { shape: 'onion', height: 6 } }));
    const swept = generateBuilding(church({ ...base, roof: { shape: 'onion', height: 6, profile: bulb } }));
    // The default onion bulges to 1.22 of the footprint, this one to 1.5.
    expect(plain.bounds.max[0]).toBeCloseTo(3 + 3 * 1.22, 2);
    expect(swept.bounds.max[0]).toBeCloseTo(3 + 3 * 1.5, 2);
    // A profile that does not run from 0 to 1 is ignored.
    const bad = generateBuilding(
      church({ ...base, roof: { shape: 'onion', height: 6, profile: [[1, 0.2]] } }),
    );
    expect(bad.bounds.max[0]).toBeCloseTo(plain.bounds.max[0], 3);
  });

  it('runs the eave straight past buttresses mapped into the outline', () => {
    // A hall with a buttress of 1 x 0.8 m in the middle of each long side.
    const outer: [number, number][] = [
      [0, 0],
      [9.5, 0],
      [9.5, -0.8],
      [10.5, -0.8],
      [10.5, 0],
      [20, 0],
      [20, 10],
      [10.5, 10],
      [10.5, 10.8],
      [9.5, 10.8],
      [9.5, 10],
      [0, 10],
    ];
    const plain = straightEaves(
      generateBuilding(church({ footprint: { outer: rect(20, 10) } })).debug?.spec as never,
    );
    expect(plain).toBeNull();
    const mesh = generateBuilding(
      church({ footprint: { outer }, height: 14, roof: { shape: 'gabled', height: 5 } }),
    );
    const body = partsOf(mesh).find((p) => p.spec.volume === 'main');
    if (!body) throw new Error('no body');
    const eaves = straightEaves(body.spec);
    expect(eaves?.bumps.length).toBe(2);
    expect(eaves?.spec.footprint.outer.length).toBe(8);
    // The buttress walls end at the eave; the walls beside them do too (they are the eave).
    expect(body.walls.filter((w) => w.top.length > 0).length).toBe(2);
    // Nothing of the roof hangs over the buttresses: above the eave the mesh is as wide as the hall.
    let south = 0;
    for (let i = 0; i < mesh.positions.length; i += 3)
      if ((mesh.positions[i + 1] as number) > 9.05) south = Math.max(south, mesh.positions[i + 2] as number);
    expect(south).toBeLessThan(0.01);
  });
});
