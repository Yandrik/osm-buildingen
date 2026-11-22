import { emptyTags } from './tags';
import type { LatLonBBox, OsmData, OsmMember, OsmNode, OsmRelation, OsmWay, Tags } from './types';

/*
 * Hand-written scanner for `.osm` XML. DOMParser does not exist in workers or
 * Node, and a general XML parser is far more than OSM needs: a flat list of
 * elements with attributes, at most one level of children (nd, tag, member).
 * The scanner walks the text once with indexOf and never builds a tree.
 */

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[body] ?? whole;
  });
}

const isSpace = (c: number): boolean => c === 32 || c === 10 || c === 13 || c === 9;

type Open =
  | { kind: 'node'; node: OsmNode; tags: Tags; hasTags: boolean; skip: boolean }
  | { kind: 'way'; way: OsmWay; skip: boolean }
  | { kind: 'relation'; relation: OsmRelation; skip: boolean };

/**
 * Parses an OSM XML document (API `map` call, JOSM save, Overpass `[out:xml]`).
 * Elements marked `action="delete"` or `visible="false"` are dropped.
 * Throws when the text contains no `<osm>` element.
 */
export function parseOsmXml(text: string): OsmData {
  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  const relations: OsmRelation[] = [];
  let bounds: LatLonBBox | undefined;
  let sawRoot = false;
  let open: Open | null = null;

  // Attributes of the current start tag, reused between tags.
  const names: string[] = [];
  const values: string[] = [];
  let count = 0;
  const attr = (name: string): string | undefined => {
    for (let k = 0; k < count; k++) if (names[k] === name) return values[k];
    return undefined;
  };
  const num = (name: string): number => {
    const v = attr(name);
    return v === undefined ? Number.NaN : Number(v);
  };
  const deleted = (): boolean => attr('action') === 'delete' || attr('visible') === 'false';

  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    const c1 = text.charCodeAt(lt + 1);

    if (c1 === 63 /* ? */) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (c1 === 33 /* ! */) {
      let end: number;
      if (text.startsWith('<!--', lt)) end = text.indexOf('-->', lt + 4) + 3;
      else if (text.startsWith('<![CDATA[', lt)) end = text.indexOf(']]>', lt + 9) + 3;
      else end = text.indexOf('>', lt + 2) + 1;
      if (end <= 0) break;
      i = end;
      continue;
    }
    if (c1 === 47 /* / */) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) break;
      const name = text.slice(lt + 2, end).trim();
      if (open && name === open.kind) {
        finish(open);
        open = null;
      }
      i = end + 1;
      continue;
    }

    // Start tag: name, then attributes.
    let j = lt + 1;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isSpace(c) || c === 47 || c === 62) break;
      j++;
    }
    const name = text.slice(lt + 1, j);
    count = 0;
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      let c = text.charCodeAt(j);
      while (isSpace(c)) c = text.charCodeAt(++j);
      if (c === 62 /* > */) {
        j++;
        closed = true;
        break;
      }
      if (c === 47 /* / */) {
        selfClosing = true;
        j++;
        continue;
      }
      if (j >= n) break;
      const nameStart = j;
      while (j < n) {
        c = text.charCodeAt(j);
        if (c === 61 /* = */ || isSpace(c) || c === 62 || c === 47) break;
        j++;
      }
      const attrName = text.slice(nameStart, j);
      while (isSpace(text.charCodeAt(j))) j++;
      if (text.charCodeAt(j) !== 61) continue; // attribute without value: ignore
      j++;
      while (isSpace(text.charCodeAt(j))) j++;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") {
        j++;
        continue;
      }
      const valueEnd = text.indexOf(quote, j + 1);
      if (valueEnd < 0) {
        j = n;
        break;
      }
      let value = text.slice(j + 1, valueEnd);
      if (value.indexOf('&') >= 0) value = decodeEntities(value);
      names[count] = attrName;
      values[count] = value;
      count++;
      j = valueEnd + 1;
    }
    if (!closed) break; // truncated document
    i = j;

    switch (name) {
      case 'osm':
        sawRoot = true;
        break;
      case 'bounds': {
        const b = {
          minLat: num('minlat'),
          minLon: num('minlon'),
          maxLat: num('maxlat'),
          maxLon: num('maxlon'),
        };
        if (Object.values(b).every(Number.isFinite)) bounds = b;
        break;
      }
      case 'bound': {
        // Osmosis: <bound box="minlat,minlon,maxlat,maxlon" .../>
        const box = (attr('box') ?? '').split(',').map(Number);
        if (box.length === 4 && box.every(Number.isFinite)) {
          const [minLat, minLon, maxLat, maxLon] = box as [number, number, number, number];
          bounds = { minLat, minLon, maxLat, maxLon };
        }
        break;
      }
      case 'node': {
        const node: OsmNode = { id: num('id'), lat: num('lat'), lon: num('lon') };
        const skip = deleted() || !Number.isFinite(node.lat) || !Number.isFinite(node.lon);
        const o: Open = { kind: 'node', node, tags: emptyTags(), hasTags: false, skip };
        if (selfClosing) finish(o);
        else open = o;
        break;
      }
      case 'way': {
        const o: Open = {
          kind: 'way',
          way: { id: num('id'), nodes: [], tags: emptyTags() },
          skip: deleted(),
        };
        if (selfClosing) finish(o);
        else open = o;
        break;
      }
      case 'relation': {
        const o: Open = {
          kind: 'relation',
          relation: { id: num('id'), members: [], tags: emptyTags() },
          skip: deleted(),
        };
        if (selfClosing) finish(o);
        else open = o;
        break;
      }
      case 'nd':
        if (open?.kind === 'way') open.way.nodes.push(num('ref'));
        break;
      case 'member': {
        if (open?.kind !== 'relation') break;
        const type = attr('type');
        if (type === 'node' || type === 'way' || type === 'relation') {
          const member: OsmMember = { type, ref: num('ref'), role: attr('role') ?? '' };
          open.relation.members.push(member);
        }
        break;
      }
      case 'tag': {
        if (!open) break;
        const k = attr('k');
        const v = attr('v');
        if (k === undefined || v === undefined) break;
        if (open.kind === 'node') {
          open.tags[k] = v;
          open.hasTags = true;
        } else if (open.kind === 'way') open.way.tags[k] = v;
        else open.relation.tags[k] = v;
        break;
      }
    }
  }

  if (!sawRoot) throw new Error('parseOsmXml: no <osm> element found; is this an OSM XML file?');
  const data: OsmData = { nodes, ways, relations };
  if (bounds) data.bounds = bounds;
  return data;

  function finish(o: Open): void {
    if (o.skip) return;
    if (o.kind === 'node') {
      if (o.hasTags) o.node.tags = o.tags;
      nodes.push(o.node);
    } else if (o.kind === 'way') ways.push(o.way);
    else relations.push(o.relation);
  }
}
