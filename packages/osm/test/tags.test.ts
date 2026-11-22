import { describe, expect, it } from 'vitest';
import { parseDirection, parseLength, parseLevels, parseRoofShape, parseYear } from '../src';
import { classify, skipReason, specialReason } from '../src/classify';
import { roadClass } from '../src/roads';
import { emptyTags } from '../src/tags';
import type { Tags } from '../src/types';

const tags = (o: Record<string, string>): Tags => Object.assign(emptyTags(), o);

describe('parseLength', () => {
  it.each([
    ['12', 12],
    ['12 m', 12],
    ['12.5m', 12.5],
    ['12,5', 12.5],
    [' 7 metres ', 7],
    ['40 ft', 40 * 0.3048],
    ["12'", 12 * 0.3048],
    ['12\'6"', 12 * 0.3048 + 6 * 0.0254],
    ['.5', 0.5],
  ])('%s', (text, metres) => {
    expect(parseLength(text)).toBeCloseTo(metres, 6);
  });

  it.each(['', 'tall', '12 storeys', '-3', 'NaN', '1e5', '5000', '12;15', undefined])(
    'rejects %s',
    (text) => {
      expect(parseLength(text)).toBeUndefined();
    },
  );
});

describe('parseLevels', () => {
  it('parses integers and rounds fractions', () => {
    expect(parseLevels('3')).toBe(3);
    expect(parseLevels('2.5')).toBe(3);
    expect(parseLevels('0')).toBe(0);
    expect(parseLevels('3;4')).toBe(3);
    expect(parseLevels('many')).toBeUndefined();
    expect(parseLevels('-1')).toBeUndefined();
  });
});

describe('parseDirection', () => {
  it('reads degrees and compass letters', () => {
    expect(parseDirection('45')).toBe(45);
    expect(parseDirection('45°')).toBe(45);
    expect(parseDirection('-90')).toBe(270);
    expect(parseDirection('370')).toBe(10);
    expect(parseDirection('N')).toBe(0);
    expect(parseDirection('ne')).toBe(45);
    expect(parseDirection('SSW')).toBe(202.5);
    expect(parseDirection('W')).toBe(270);
    expect(parseDirection('up')).toBeUndefined();
  });
});

describe('parseYear', () => {
  it.each([
    ['1993', 1993],
    ['1993-05-01', 1993],
    ['1993-05', 1993],
    ['~1890', 1890],
    ['ca. 1890', 1890],
    ['1890s', 1895],
    ['C19', 1850],
    ['early C19', 1815],
    ['late 19th century', 1885],
    ['1890..1900', 1895],
    ['1890-1900', 1895],
    ['before 1900', 1890],
    ['1377', 1377],
    ['1900~', 1900],
  ])('%s', (text, year) => {
    expect(parseYear(text)).toBe(year);
  });

  it.each(['', 'old', '93', '3000', 'yes'])('rejects %s', (text) => {
    expect(parseYear(text)).toBeUndefined();
  });
});

describe('parseRoofShape', () => {
  it('maps OSM values to core shapes and drops unknown ones', () => {
    expect(parseRoofShape('gabled')).toBe('gabled');
    expect(parseRoofShape('half-hipped')).toBe('half-hipped');
    expect(parseRoofShape('half_hipped')).toBe('half-hipped');
    expect(parseRoofShape('Pyramidal')).toBe('pyramidal');
    expect(parseRoofShape('mansard')).toBe('mansard');
    expect(parseRoofShape('dome')).toBe('dome');
    expect(parseRoofShape('sawtooth')).toBe('sawtooth');
    expect(parseRoofShape('many')).toBeUndefined();
    expect(parseRoofShape('many')).toBeUndefined();
  });
});

describe('classification', () => {
  const ctx = { area: 120, levels: 3, shopSource: undefined, denseRow: false };

  it('uses building=* first', () => {
    expect(classify(tags({ building: 'detached' }), ctx).type).toBe('house');
    expect(classify(tags({ building: 'terrace' }), ctx).type).toBe('townhouse');
    expect(classify(tags({ building: 'carport' }), ctx).type).toBe('canopy');
    expect(classify(tags({ building: 'roof', amenity: 'fuel' }), ctx).type).toBe('canopy');
    expect(classify(tags({ building: 'garage' }), ctx).type).toBe('garage');
    expect(classify(tags({ building: 'warehouse' }), ctx).type).toBe('industrial');
    expect(classify(tags({ building: 'retail' }), ctx).type).toBe('store');
    expect(classify(tags({ building: 'train_station' }), ctx).type).toBe('station');
  });

  it('splits building=residential by size', () => {
    expect(classify(tags({ building: 'residential' }), ctx).type).toBe('house');
    expect(classify(tags({ building: 'residential' }), { ...ctx, area: 400 }).type).toBe('apartments');
    expect(classify(tags({ building: 'residential' }), { ...ctx, levels: 5 }).type).toBe('apartments');
  });

  it('falls back to other tags for building=yes', () => {
    expect(classify(tags({ building: 'yes', office: 'company' }), ctx).type).toBe('office');
    expect(classify(tags({ building: 'yes', railway: 'station' }), ctx).type).toBe('station');
    expect(classify(tags({ building: 'yes', man_made: 'works' }), ctx).type).toBe('industrial');
    expect(classify(tags({ building: 'yes', amenity: 'shelter' }), ctx).type).toBe('canopy');
    expect(
      classify(tags({ building: 'yes', amenity: 'shelter', shelter_type: 'public_transport' }), ctx).type,
    ).toBe('canopy');
    expect(classify(tags({ building: 'yes', amenity: 'shelter', shelter_type: 'basic_hut' }), ctx).type).toBe(
      'shed',
    );
    expect(classify(tags({ building: 'yes' }), ctx).type).toBeUndefined();
  });

  it('turns shops into stores or townhouses with a shop', () => {
    const one = { ...ctx, levels: 1, shopSource: 'shop=bakery' };
    expect(classify(tags({ building: 'yes' }), one)).toMatchObject({ type: 'store', shop: true });
    expect(classify(tags({ building: 'yes' }), { ...one, levels: 4 })).toMatchObject({
      type: 'townhouse',
      shop: true,
    });
    expect(classify(tags({ building: 'yes' }), { ...one, denseRow: true }).type).toBe('townhouse');
  });

  it('flags special buildings and skips non-buildings', () => {
    expect(specialReason(tags({ building: 'church' }))).toBe('building=church');
    expect(specialReason(tags({ building: 'yes', amenity: 'place_of_worship' }))).toBeDefined();
    expect(specialReason(tags({ building: 'yes', man_made: 'tower' }))).toBeDefined();
    expect(specialReason(tags({ building: 'house' }))).toBeUndefined();
    expect(skipReason(tags({ building: 'construction' }))).toBeDefined();
    expect(skipReason(tags({ building: 'yes', location: 'underground' }))).toBeDefined();
    expect(skipReason(tags({ building: 'yes' }))).toBeUndefined();
  });
});

describe('roadClass', () => {
  it('derives kind and width', () => {
    expect(roadClass(tags({ highway: 'residential' }))).toMatchObject({ kind: 'road', width: 6 });
    expect(roadClass(tags({ highway: 'primary', lanes: '4' }))?.width).toBe(12);
    expect(roadClass(tags({ highway: 'service', width: '3.5 m' }))?.width).toBe(3.5);
    expect(roadClass(tags({ highway: 'footway' }))?.kind).toBe('path');
    expect(roadClass(tags({ railway: 'tram' }))?.kind).toBe('rail');
    expect(roadClass(tags({ highway: 'footway', tunnel: 'building_passage' }))?.passage).toBe(true);
  });

  it('ignores areas, platforms, proposed roads and tunnels', () => {
    expect(roadClass(tags({ highway: 'pedestrian', area: 'yes' }))).toBeUndefined();
    expect(roadClass(tags({ highway: 'platform' }))).toBeUndefined();
    expect(roadClass(tags({ highway: 'proposed' }))).toBeUndefined();
    expect(roadClass(tags({ highway: 'construction' }))).toBeUndefined();
    expect(roadClass(tags({ highway: 'primary', tunnel: 'yes' }))).toBeUndefined();
    expect(roadClass(tags({ railway: 'abandoned' }))).toBeUndefined();
  });
});
