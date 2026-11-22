import { emptyTags } from './tags';
import type { LatLonBBox, OsmData, OsmMember, OsmNode, OsmRelation, OsmWay, Tags } from './types';

/*
 * Overpass `[out:json]` reader. Supports `out body; >; out skel qt;` (ways and
 * relations refer to nodes listed separately) and `out geom;` for ways, whose
 * inline `geometry` is turned into nodes when the referenced nodes are missing.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readTags(v: unknown): Tags {
  const tags = emptyTags();
  if (!isObject(v)) return tags;
  for (const key of Object.keys(v)) {
    const value = v[key];
    if (typeof value === 'string') tags[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') tags[key] = String(value);
  }
  return tags;
}

/**
 * Parses an Overpass API `[out:json]` response (an object with an `elements`
 * array). Throws a readable error for anything else, including Overpass
 * runtime errors reported in `remark`.
 */
export function parseOverpassJson(json: unknown): OsmData {
  if (!isObject(json) || !Array.isArray(json.elements)) {
    throw new Error('parseOverpassJson: expected an object with an "elements" array');
  }
  const remark = typeof json.remark === 'string' ? json.remark : '';
  if (json.elements.length === 0 && /error/i.test(remark)) {
    throw new Error(`parseOverpassJson: Overpass reported an error: ${remark}`);
  }

  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  const relations: OsmRelation[] = [];
  const nodeIds = new Set<number>();
  // Inline way geometries, used only for node ids that are not listed.
  const inline: { ids: number[]; geometry: unknown[] }[] = [];

  for (const el of json.elements as unknown[]) {
    if (!isObject(el) || !isNumber(el.id)) continue;
    if (el.type === 'node') {
      if (!isNumber(el.lat) || !isNumber(el.lon)) continue;
      const node: OsmNode = { id: el.id, lat: el.lat, lon: el.lon };
      if (isObject(el.tags) && Object.keys(el.tags).length > 0) node.tags = readTags(el.tags);
      nodes.push(node);
      nodeIds.add(el.id);
    } else if (el.type === 'way') {
      const ids = Array.isArray(el.nodes) ? el.nodes.filter(isNumber) : [];
      ways.push({ id: el.id, nodes: ids, tags: readTags(el.tags) });
      if (Array.isArray(el.geometry) && el.geometry.length === ids.length) {
        inline.push({ ids, geometry: el.geometry });
      }
    } else if (el.type === 'relation') {
      const members: OsmMember[] = [];
      if (Array.isArray(el.members)) {
        for (const m of el.members) {
          if (!isObject(m) || !isNumber(m.ref)) continue;
          if (m.type !== 'node' && m.type !== 'way' && m.type !== 'relation') continue;
          members.push({ type: m.type, ref: m.ref, role: typeof m.role === 'string' ? m.role : '' });
        }
      }
      relations.push({ id: el.id, members, tags: readTags(el.tags) });
    }
  }

  for (const { ids, geometry } of inline) {
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k] as number;
      const g = geometry[k];
      if (nodeIds.has(id) || !isObject(g) || !isNumber(g.lat) || !isNumber(g.lon)) continue;
      nodes.push({ id, lat: g.lat, lon: g.lon });
      nodeIds.add(id);
    }
  }

  const data: OsmData = { nodes, ways, relations };
  const b = json.bounds;
  if (isObject(b) && isNumber(b.minlat) && isNumber(b.minlon) && isNumber(b.maxlat) && isNumber(b.maxlon)) {
    const bounds: LatLonBBox = { minLat: b.minlat, minLon: b.minlon, maxLat: b.maxlat, maxLon: b.maxlon };
    data.bounds = bounds;
  }
  return data;
}
