import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOsmXml, parseOverpassJson } from '../src';
import { overpassQuery } from '../src/overpass';

const FIXTURE = new URL('./fixtures/ulm-minster.osm', import.meta.url);

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!-- comment with <tags> inside -->
<osm version="0.6" generator="test">
  <bounds minlat="48.0" minlon="9.0" maxlat="48.001" maxlon="9.001"/>
  <node id="1" lat="48.0001" lon="9.0001"/>
  <node id="2" lat="48.0001" lon="9.0003"/>
  <node id='3' lat='48.0003' lon='9.0003'/>
  <node id="4" lat="48.0003" lon="9.0001">
    <tag k="addr:housenumber" v="5"/>
    <tag k="name" v="Caf&eacute; &amp; Bar &lt;&quot;x&quot;&gt; &#252;&#x00FC;"/>
  </node>
  <node id="5" lat="48.0" lon="9.0" action="delete"/>
  <node id="6" lat="48.0" lon="9.0" visible="false"/>
  <way id="10">
    <nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
    <tag k="building" v="house"/>
    <tag k="note" v="a > b"/>
  </way>
  <way id="11"/>
  <relation id="20">
    <member type="way" ref="10" role="outer"/>
    <member type="node" ref="4" role=""/>
    <tag k="type" v="multipolygon"/>
  </relation>
</osm>`;

describe('parseOsmXml', () => {
  it('reads nodes, ways, relations, tags and bounds', () => {
    const d = parseOsmXml(SAMPLE_XML);
    expect(d.bounds).toEqual({ minLat: 48, minLon: 9, maxLat: 48.001, maxLon: 9.001 });
    expect(d.nodes.map((n) => n.id)).toEqual([1, 2, 3, 4]);
    expect(d.nodes[2]).toEqual({ id: 3, lat: 48.0003, lon: 9.0003 });
    expect(d.nodes[0]?.tags).toBeUndefined();
    // Unknown named entities stay as they are; numeric ones are decoded.
    expect(d.nodes[3]?.tags?.name).toBe('Caf&eacute; & Bar <"x"> üü');
    expect(d.ways).toHaveLength(2);
    expect(d.ways[0]?.nodes).toEqual([1, 2, 3, 4, 1]);
    expect({ ...d.ways[0]?.tags }).toEqual({ building: 'house', note: 'a > b' });
    expect(d.ways[1]).toMatchObject({ id: 11, nodes: [] });
    expect(d.relations[0]?.members).toEqual([
      { type: 'way', ref: 10, role: 'outer' },
      { type: 'node', ref: 4, role: '' },
    ]);
  });

  it('rejects documents that are not OSM', () => {
    expect(() => parseOsmXml('<html><body>Error</body></html>')).toThrow(/no <osm> element/);
  });

  it('parses the Ulm fixture quickly', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const t = performance.now();
    const d = parseOsmXml(text);
    const ms = performance.now() - t;
    expect(d.nodes).toHaveLength(6664);
    expect(d.ways).toHaveLength(1295);
    expect(d.relations).toHaveLength(127);
    expect(d.bounds).toEqual({ minLat: 48.396543, minLon: 9.988128, maxLat: 48.400058, maxLon: 9.995933 });
    expect(d.ways.filter((w) => w.tags.building !== undefined)).toHaveLength(613);
    expect(d.ways.filter((w) => w.tags['building:part'] !== undefined)).toHaveLength(96);
    const mp = d.relations.filter((r) => r.tags.type === 'multipolygon' && r.tags.building !== undefined);
    expect(mp).toHaveLength(5);
    // 2.4 MB; generous bound so slow CI machines pass.
    expect(ms).toBeLessThan(500);
  });
});

describe('parseOverpassJson', () => {
  const sample = {
    version: 0.6,
    elements: [
      { type: 'node', id: 1, lat: 48.0001, lon: 9.0001 },
      { type: 'node', id: 2, lat: 48.0001, lon: 9.0003, tags: { shop: 'bakery' } },
      { type: 'node', id: 3, lat: 48.0003, lon: 9.0003 },
      {
        type: 'way',
        id: 10,
        nodes: [1, 2, 3, 4, 1],
        tags: { building: 'yes', 'building:levels': 3 },
        // out geom: node 4 is only known from here
        geometry: [
          { lat: 48.0001, lon: 9.0001 },
          { lat: 48.0001, lon: 9.0003 },
          { lat: 48.0003, lon: 9.0003 },
          { lat: 48.0003, lon: 9.0001 },
          { lat: 48.0001, lon: 9.0001 },
        ],
      },
      {
        type: 'relation',
        id: 20,
        members: [
          { type: 'way', ref: 10, role: 'outer' },
          { type: 'bogus', ref: 1 },
        ],
        tags: { type: 'multipolygon' },
      },
      'garbage',
      { type: 'node', id: 99 },
    ],
  };

  it('reads elements and fills nodes from inline geometry', () => {
    const d = parseOverpassJson(sample);
    expect(d.nodes.map((n) => n.id).sort()).toEqual([1, 2, 3, 4]);
    expect(d.nodes.find((n) => n.id === 4)).toEqual({ id: 4, lat: 48.0003, lon: 9.0001 });
    expect(d.nodes.find((n) => n.id === 2)?.tags?.shop).toBe('bakery');
    expect(d.ways[0]?.tags['building:levels']).toBe('3');
    expect(d.relations[0]?.members).toEqual([{ type: 'way', ref: 10, role: 'outer' }]);
  });

  it('rejects non-Overpass JSON', () => {
    expect(() => parseOverpassJson({ foo: 1 })).toThrow(/elements/);
    expect(() => parseOverpassJson(null)).toThrow();
    expect(() => parseOverpassJson({ elements: [], remark: 'runtime error: Query timed out' })).toThrow(
      /timed out/,
    );
  });

  it('round-trips the fixture through the Overpass JSON shape', () => {
    const xml = parseOsmXml(readFileSync(FIXTURE, 'utf8'));
    const json = JSON.parse(
      JSON.stringify({
        elements: [
          ...xml.nodes.map((n) => ({ type: 'node', ...n })),
          ...xml.ways.map((w) => ({ type: 'way', ...w })),
          ...xml.relations.map((r) => ({ type: 'relation', ...r })),
        ],
      }),
    );
    const d = parseOverpassJson(json);
    expect(d.nodes).toHaveLength(xml.nodes.length);
    expect(d.ways).toHaveLength(xml.ways.length);
    expect(d.relations).toHaveLength(xml.relations.length);
  });
});

describe('overpassQuery', () => {
  it('asks for buildings, parts, roads and address nodes in the bbox', () => {
    const q = overpassQuery({ minLat: 48.39, minLon: 9.98, maxLat: 48.4, maxLon: 9.99 });
    expect(q).toContain('[out:json]');
    expect(q).toContain('way["building"](48.39,9.98,48.4,9.99);');
    expect(q).toContain('relation["building"]');
    expect(q).toContain('way["highway"]');
    expect(q).toContain('node["addr:housenumber"]');
    expect(q).toContain('>;');
    expect(q).not.toContain('natural');
  });

  it('adds trees and wooded areas on request', () => {
    const q = overpassQuery({ minLat: 48.39, minLon: 9.98, maxLat: 48.4, maxLon: 9.99 }, 60, true);
    expect(q).toContain('node["natural"="tree"](48.39,9.98,48.4,9.99);');
    expect(q).toContain('way["landuse"="forest"]');
    expect(q).toContain('relation["natural"="wood"]');
    expect(q.indexOf('relation["natural"="wood"]')).toBeLessThan(q.indexOf('\n);'));
  });
});
