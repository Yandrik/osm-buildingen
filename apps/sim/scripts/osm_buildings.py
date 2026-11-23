"""
Buildings and building parts with their 3D tags from a full OSM .pbf, cut into the sim's
z14 tiles (same scaled Web Mercator frame as data/osm/tiles, see data/osm/README.md).

The Geofabrik "free" shapefiles drop building:part and all height / roof tags, so landmarks
such as the Arc de Triomphe (parts with min_height) and towers (height, levels) come out
as plain blocks. This keeps them.

    python -I scripts/osm_buildings.py ile_de_france.pbf data/osm/buildings

Needs: osmium (pyosmium), shapely, numpy.

Output: buildings/14/<x>/<y>.json, a JSON list of
    {"id": osm id (ways > 0, relations < 0), "t": {tags}, "g": polygon, "p": [{"t": {tags}, "g": polygon}]}
Polygons are [[outer CCW], [hole CW], ...] in tile-local metres (x east, y north from the
tile's SW corner), rings open, rounded to 0.05 m. A building goes to the tile of its
point-on-surface; its parts go with it. Parts outside any building become buildings of
their own. Plus buildings/index.json with the tile list.
"""

import json
import math
import os
import sys
import time

import numpy as np
import osmium
import shapely
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

BBOX = (1.8621, 48.6478, 2.8612, 49.0936)
R = 6378137.0
Z = 14
TILE_MERC = 2 * math.pi * R / 2**Z
TILE_M = 1608.9
K = TILE_M / TILE_MERC

KEEP = {
    'building', 'building:part', 'height', 'min_height', 'building:levels', 'building:min_level',
    'roof:shape', 'roof:height', 'roof:levels', 'roof:direction', 'roof:orientation', 'roof:colour',
    'building:colour', 'start_date', 'name', 'amenity', 'shop', 'office', 'tourism', 'railway',
    'public_transport', 'man_made', 'industrial', 'shelter_type', 'location', 'addr:housenumber',
    'historic', 'leisure', 'ruins',
}
SKIP_VALUES = {'no', 'none', 'proposed', 'construction', 'demolished', 'destroyed', 'razed', 'removed'}


def merc(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    return R * np.radians(lon), R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.items = []  # (kind, id, tags, [ (outer_xy, [hole_xy...]) ])

    def area(self, a):
        tags = a.tags
        b = tags.get('building')
        p = tags.get('building:part')
        if b is not None and b not in SKIP_VALUES:
            kind = 'b'
        elif p is not None and p not in SKIP_VALUES:
            kind = 'p'
        else:
            return
        if tags.get('location') in ('underground', 'underwater'):
            return
        polys = []
        try:
            for outer in a.outer_rings():
                pts = [(n.lon, n.lat) for n in outer]
                if not pts:
                    continue
                lon0, lat0 = pts[0]
                if not (BBOX[0] - 0.01 <= lon0 <= BBOX[2] + 0.01 and BBOX[1] - 0.01 <= lat0 <= BBOX[3] + 0.01):
                    continue
                holes = [[(n.lon, n.lat) for n in inner] for inner in a.inner_rings(outer)]
                polys.append((pts, holes))
        except osmium.InvalidLocationError:
            return
        if not polys:
            return
        oid = a.orig_id() if a.from_way() else -a.orig_id()
        keep = {k: v for k, v in ((t.k, t.v) for t in tags) if k in KEEP}
        self.items.append((kind, oid, keep, polys))


def to_merc_poly(pts, holes):
    def ring(r):
        x, y = merc([p[0] for p in r], [p[1] for p in r])
        return list(zip(x.tolist(), y.tolist()))

    try:
        poly = Polygon(ring(pts), [ring(h) for h in holes if len(h) >= 4])
    except (ValueError, TypeError):
        return None
    if not poly.is_valid:
        poly = shapely.make_valid(poly)
        if poly.geom_type == 'MultiPolygon':
            poly = max(poly.geoms, key=lambda g: g.area)
        if poly.geom_type != 'Polygon':
            return None
    if poly.area < 1.0:
        return None
    return orient(poly, 1.0)


def tile_of(x, y):
    tx = math.floor((x + math.pi * R) / TILE_MERC)
    ty = math.floor((math.pi * R - y) / TILE_MERC)
    return tx, ty


def local(poly, tx, ty):
    west = -math.pi * R + tx * TILE_MERC
    south = math.pi * R - (ty + 1) * TILE_MERC

    def ring(coords):
        out = []
        for x, y in list(coords)[:-1]:
            p = [round((x - west) * K * 20) / 20, round((y - south) * K * 20) / 20]
            if not out or out[-1] != p:
                out.append(p)
        if len(out) > 1 and out[0] == out[-1]:
            out.pop()
        return out

    rings = [ring(poly.exterior.coords)] + [ring(i.coords) for i in poly.interiors]
    rings = [r for r in rings if len(r) >= 3]
    return rings if rings and len(rings[0]) >= 3 else None


def main():
    src, out = sys.argv[1], sys.argv[2]
    t0 = time.time()
    c = Collector()
    c.apply_file(src, locations=True, idx='flex_mem')
    print(f'read {len(c.items)} areas in {time.time() - t0:.0f}s', flush=True)

    buildings, parts = [], []
    for kind, oid, tags, polys in c.items:
        for pts, holes in polys:
            poly = to_merc_poly(pts, holes)
            if poly is None:
                continue
            rep = poly.representative_point()
            lon = math.degrees(rep.x / R)
            lat = math.degrees(2 * math.atan(math.exp(rep.y / R)) - math.pi / 2)
            if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
                continue
            (buildings if kind == 'b' else parts).append((oid, tags, poly, rep))
    del c
    print(f'{len(buildings)} buildings, {len(parts)} parts in bbox ({time.time() - t0:.0f}s)', flush=True)

    # Each part joins the smallest building that contains its point-on-surface.
    tree = shapely.STRtree([b[2] for b in buildings])
    areas = np.array([b[2].area for b in buildings])
    part_reps = [p[3] for p in parts]
    pairs = tree.query(part_reps, predicate='within')
    owner = {}
    for pi, bi in zip(pairs[0].tolist(), pairs[1].tolist()):
        if pi not in owner or areas[bi] < areas[owner[pi]]:
            owner[pi] = bi
    children = {}
    for pi, bi in owner.items():
        children.setdefault(bi, []).append(pi)
    print(f'{len(owner)} parts matched to {len(children)} buildings', flush=True)

    tiles = {}

    def emit(tx, ty, entry):
        tiles.setdefault((tx, ty), []).append(entry)

    for bi, (oid, tags, poly, rep) in enumerate(buildings):
        tx, ty = tile_of(rep.x, rep.y)
        g = local(poly, tx, ty)
        if g is None:
            continue
        entry = {'id': oid, 't': tags, 'g': g}
        plist = []
        for pi in children.get(bi, []):
            pg = local(parts[pi][2], tx, ty)
            if pg is not None:
                plist.append({'t': parts[pi][1], 'g': pg})
        if plist:
            entry['p'] = plist
        emit(tx, ty, entry)
    orphans = 0
    for pi, (oid, tags, poly, rep) in enumerate(parts):
        if pi in owner:
            continue
        tx, ty = tile_of(rep.x, rep.y)
        g = local(poly, tx, ty)
        if g is None:
            continue
        orphans += 1
        emit(tx, ty, {'id': oid, 't': tags, 'g': g, 'p': [{'t': tags, 'g': g}]})

    index = []
    for (tx, ty), entries in sorted(tiles.items()):
        d = os.path.join(out, str(Z), str(tx))
        os.makedirs(d, exist_ok=True)
        data = json.dumps(entries, separators=(',', ':'), ensure_ascii=False)
        with open(os.path.join(d, f'{ty}.json'), 'w', encoding='utf-8') as f:
            f.write(data)
        index.append([tx, ty, len(entries), len(data)])
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump({'zoom': Z, 'bbox': BBOX, 'tiles': index, 'orphanParts': orphans}, f)
    print(f'{len(index)} tiles, {orphans} orphan parts, {sum(i[3] for i in index) / 1e6:.0f} MB, '
          f'{time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
