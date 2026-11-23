/** One feature of a z14 OSM tile (see data/osm/README.md). Coordinates are tile-local metres. */
export interface OsmFeature<G = unknown> {
  id: number;
  c: string;
  n?: string;
  p?: Record<string, string | number>;
  g: G;
}

export type Pt = [number, number];
export type Line = Pt[];
export type Poly = Pt[][];

export interface OsmTile {
  buildings_a?: OsmFeature<Poly>[];
  roads?: OsmFeature<Line>[];
  railways?: OsmFeature<Line>[];
  waterways?: OsmFeature<Line>[];
  water_a?: OsmFeature<Poly>[];
  landuse_a?: OsmFeature<Poly>[];
  natural_a?: OsmFeature<Poly>[];
  pois_a?: OsmFeature<Poly>[];
  traffic_a?: OsmFeature<Poly>[];
  protected_areas_a?: OsmFeature<Poly>[];
  natural?: OsmFeature<Pt>[];
  places?: OsmFeature<Pt>[];
  [layer: string]: OsmFeature[] | undefined;
}

/** A building from the full extract (`data/osm/buildings`): OSM tags plus its parts. */
export interface TaggedBuilding {
  /** OSM id; relations are negative. */
  id: number;
  t: Record<string, string>;
  g: Poly;
  p?: { t: Record<string, string>; g: Poly }[];
}

export function mergeTiles(a: OsmTile, b: OsmTile): OsmTile {
  const out: OsmTile = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!v) continue;
    out[k] = [...(out[k] ?? []), ...v];
  }
  return out;
}
