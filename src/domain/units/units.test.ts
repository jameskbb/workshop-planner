import { describe, expect, it } from 'vitest';
import {
  cm,
  feet,
  feetInches,
  formatAngle,
  formatArea,
  formatLength,
  formatWeight,
  inches,
  lb,
  meters,
  mustParseLength,
  parseAngle,
  parseLength,
  quantize,
} from './index';

const FOUR_SIX = 1371.6; // 54 in

describe('quantize', () => {
  it('snaps to the canonical lattice (0.000001 mm)', () => {
    expect(quantize(1.2345678)).toBe(1.234568);
    expect(quantize(1.2345675001)).toBe(1.234568);
    expect(quantize(-0.0000001)).toBe(0);
    expect(Object.is(quantize(-0.0000001), 0)).toBe(true);
  });
  // R-013: the lattice must contain the fractional inches the UI offers, or repeated fractional
  // edits drift (1/16" used to snap 1.5875 → 1.59, i.e. 0.1" after a thousand nudges).
  it('represents 1/16", 1/32" and 1/64" exactly', () => {
    expect(quantize(inches(1 / 16))).toBe(1.5875);
    expect(quantize(inches(1 / 32))).toBe(0.79375);
    expect(quantize(inches(1 / 64))).toBe(0.396875);
    expect(inches(1 / 16)).toBe(25.4 / 16);
  });
  it('does not drift over a thousand 1/16" nudges', () => {
    const step = inches(1 / 16);
    let v = 0;
    for (let i = 0; i < 1000; i++) v = quantize(v + step);
    expect(v).toBe(inches(1000 / 16));
    expect(v).toBe(1587.5);
  });
  it('does not drift when a 1/16" step is added and removed repeatedly', () => {
    const start = inches(48);
    let v = start;
    for (let i = 0; i < 500; i++) {
      v = quantize(v + inches(1 / 16));
      v = quantize(v - inches(1 / 16));
    }
    expect(v).toBe(start);
  });
  it('is idempotent', () => {
    for (const v of [0.1, 1219.2, 1371.6, 33.33, 25.4 / 3]) {
      expect(quantize(quantize(v))).toBe(quantize(v));
    }
  });
  it('unit helpers produce canonical values', () => {
    expect(inches(48)).toBe(1219.2);
    expect(feet(4)).toBe(1219.2);
    expect(feetInches(4, 6)).toBe(FOUR_SIX);
    expect(cm(137.16)).toBe(FOUR_SIX);
    expect(meters(1.3716)).toBe(FOUR_SIX);
  });
});

describe('parseLength: brief examples', () => {
  const cases: Array<[string, number]> = [
    ['48"', 1219.2],
    ["4'", 1219.2],
    ['4\' 6"', FOUR_SIX],
    ['4 ft 6 in', FOUR_SIX],
    ['54 in', FOUR_SIX],
    ['4.5 ft', FOUR_SIX],
  ];
  for (const [input, mm] of cases) {
    it(`${input} → ${mm} mm`, () => {
      expect(parseLength(input)).toEqual({ ok: true, mm });
    });
  }
  it('all brief forms of 4\' 6" agree exactly', () => {
    const values = ['4\' 6"', '4 ft 6 in', '54 in', '4.5 ft', '54"', "4'6\"", '4\'-6"', '4 feet 6 inches'].map((s) =>
      mustParseLength(s),
    );
    expect(new Set(values).size).toBe(1);
  });
});

describe('parseLength: imperial variants', () => {
  const cases: Array<[string, number]> = [
    ['48', 1219.2],
    ['48 inches', 1219.2],
    ['48 inch', 1219.2],
    ['48in', 1219.2],
    ['48 in.', 1219.2],
    ["48''", 1219.2],
    ['4ft', 1219.2],
    ['4 ft.', 1219.2],
    ['4 foot', 1219.2],
    ['4 feet', 1219.2],
    ["4'6", FOUR_SIX],
    ["4' 6", FOUR_SIX],
    ['4ft6in', FOUR_SIX],
    ['4 ft. 6 in.', FOUR_SIX],
    ['4\'6-1/2"', inches(54.5)],
    ['4\' 6 1/2"', inches(54.5)],
    ['4\'-6 1/2"', inches(54.5)],
    ['6 1/2"', inches(6.5)],
    ['6-1/2"', inches(6.5)],
    ['1/2"', inches(0.5)],
    ['3/4', inches(0.75)],
    ['15/16"', inches(15 / 16)],
    ['1/16"', inches(1 / 16)],
    ['.5"', inches(0.5)],
    ['0.5 in', inches(0.5)],
    ['21\' 8"', feetInches(21, 8)],
    ['19\' 4"', feetInches(19, 4)],
    ['28"', inches(28)],
    ['0', 0],
    ['4′ 6″', FOUR_SIX],
    ['4’ 6”', FOUR_SIX],
    ['4 ½"', inches(4.5)],
    ["  4'  6\"  ", FOUR_SIX],
    ['4′–6″', FOUR_SIX],
    ['4\' 14"', feetInches(5, 2)],
  ];
  for (const [input, mm] of cases) {
    it(`${JSON.stringify(input)} → ${mm}`, () => {
      const r = parseLength(input);
      expect(r).toEqual({ ok: true, mm });
    });
  }
});

describe('parseLength: metric', () => {
  const cases: Array<[string, number]> = [
    ['1372 mm', 1372],
    ['1371.6mm', FOUR_SIX],
    ['137.2 cm', 1372],
    ['137.16 cm', FOUR_SIX],
    ['1.372 m', 1372],
    ['1.372m', 1372],
    ['1 m 20 cm', 1200],
    ['1m 20cm 5mm', 1205],
    ['2 meters', 2000],
    ['2 metres', 2000],
    ['25 millimeters', 25],
    ['5 centimetres', 50],
    ['0.001 mm', 0.001],
    ['0.005 mm', 0.005],
    ['0.0000001 mm', 0],
  ];
  for (const [input, mm] of cases) {
    it(`${input} → ${mm}`, () => {
      expect(parseLength(input)).toEqual({ ok: true, mm });
    });
  }
  it('bare numbers use the default unit', () => {
    expect(parseLength('1372', { defaultUnit: 'mm' })).toEqual({ ok: true, mm: 1372 });
    expect(parseLength('137.2', { defaultUnit: 'cm' })).toEqual({ ok: true, mm: 1372 });
    expect(parseLength('4.5', { defaultUnit: 'ft' })).toEqual({ ok: true, mm: FOUR_SIX });
    expect(parseLength('1.5', { defaultUnit: 'm' })).toEqual({ ok: true, mm: 1500 });
  });
  it('1372 mm and 137.2 cm resolve to the same canonical value', () => {
    expect(mustParseLength('1372 mm')).toBe(mustParseLength('137.2 cm'));
  });
});

describe('parseLength: errors', () => {
  const bad = [
    '',
    '   ',
    'abc',
    '4 6',
    '4" 6\'',
    '4\' 4\'',
    '4 ft 2 m',
    '1/0"',
    '1.5/2"',
    '4 6/4"',
    '48 x 24',
    '4\' 6" 3',
    '--4',
    '1 m 20',
    '/2',
    '4//2',
    '"',
    '12 cm 1 m',
  ];
  for (const input of bad) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      const r = parseLength(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    });
  }
  it('rejects negatives unless allowed', () => {
    expect(parseLength('-4"').ok).toBe(false);
    expect(parseLength('-4"', { allowNegative: true })).toEqual({ ok: true, mm: -101.6 });
    expect(parseLength("-4' 6\"", { allowNegative: true })).toEqual({ ok: true, mm: -FOUR_SIX });
  });
  it('rejects zero when disallowed', () => {
    expect(parseLength('0', { allowZero: false }).ok).toBe(false);
  });
  it('empty input asks for a length', () => {
    expect(parseLength('')).toEqual({ ok: false, error: 'Enter a length.' });
  });
  it('error messages give an example', () => {
    const r = parseLength('4 6');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('4\' 6"');
  });
  it('mustParseLength throws', () => {
    expect(() => mustParseLength('nope')).toThrow();
  });
});

describe('formatLength: imperial', () => {
  const cases: Array<[number, string]> = [
    [FOUR_SIX, '4\' 6"'],
    [1219.2, '4\' 0"'],
    [inches(18), '18"'],
    [inches(12), '12"'],
    [inches(23.5), '23 1/2"'],
    [inches(24), '2\' 0"'],
    [inches(54.5), '4\' 6 1/2"'],
    [inches(54.0625), '4\' 6 1/16"'],
    [inches(0.5), '1/2"'],
    [inches(1 / 16), '1/16"'],
    [0, '0"'],
    [feetInches(21, 8), '21\' 8"'],
    [inches(11.999), '12"'],
    [feetInches(4, 11.99), '5\' 0"'],
    [inches(0.01), '0"'],
  ];
  for (const [mm, text] of cases) {
    it(`${mm} → ${text}`, () => {
      expect(formatLength(mm)).toBe(text);
    });
  }
  it('negative values', () => {
    expect(formatLength(-FOUR_SIX)).toBe('-4\' 6"');
    expect(formatLength(-inches(3))).toBe('-3"');
  });
  it('respects precision', () => {
    expect(formatLength(inches(6.4), { precision: 8 })).toBe('6 3/8"');
    expect(formatLength(inches(6.3), { precision: 4 })).toBe('6 1/4"');
    expect(formatLength(inches(6.3), { precision: 1 })).toBe('6"');
    expect(formatLength(inches(6.51), { precision: 2 })).toBe('6 1/2"');
    expect(formatLength(inches(6.3), { precision: 32 })).toBe('6 5/16"');
    expect(formatLength(inches(6.3), { precision: 7 })).toBe('6 5/16"'); // invalid → 16
  });
  it('respects style', () => {
    expect(formatLength(FOUR_SIX, { imperialStyle: 'inches' })).toBe('54"');
    expect(formatLength(inches(6), { imperialStyle: 'feet-inches' })).toBe('0\' 6"');
    expect(formatLength(inches(18), { feetThresholdInches: 12 })).toBe('1\' 6"');
  });
  it('non-finite shows a dash', () => {
    expect(formatLength(Number.NaN)).toBe('n/a');
  });
});

describe('formatLength: metric', () => {
  it('mm, cm, m', () => {
    expect(formatLength(FOUR_SIX, { system: 'metric' })).toBe('1372 mm');
    expect(formatLength(FOUR_SIX, { system: 'metric', metricUnit: 'cm' })).toBe('137.2 cm');
    expect(formatLength(FOUR_SIX, { system: 'metric', metricUnit: 'm' })).toBe('1.372 m');
    expect(formatLength(FOUR_SIX, { system: 'metric', metricDecimals: 1 })).toBe('1371.6 mm');
    expect(formatLength(-0.2, { system: 'metric' })).toBe('0 mm');
  });
});

describe('round trips never drift', () => {
  it('imperial parse → format → parse is stable at 1/16"', () => {
    for (let sixteenths = 0; sixteenths <= 16 * 12 * 30; sixteenths += 7) {
      const inchesValue = sixteenths / 16;
      const mm = inches(inchesValue);
      const text = formatLength(mm, { imperialStyle: 'inches' });
      const back = mustParseLength(text);
      expect(back).toBe(mm);
      const text2 = formatLength(mm);
      expect(mustParseLength(text2)).toBe(mm);
    }
  });
  it('metric parse → format → parse is stable', () => {
    for (let mm = 0; mm < 20000; mm += 37) {
      const text = formatLength(mm, { system: 'metric' });
      expect(mustParseLength(text)).toBe(mm);
    }
  });
  it('repeated conversions stay on the lattice', () => {
    let v = mustParseLength('4\' 6 1/2"');
    for (let i = 0; i < 1000; i++) {
      v = mustParseLength(formatLength(v));
    }
    expect(v).toBe(inches(54.5));
  });
  it('summing quantized values stays quantized', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) total = quantize(total + inches(0.5));
    expect(total).toBe(12700);
  });
});

describe('parseAngle / formatAngle / area / weight', () => {
  it('parses angles', () => {
    expect(parseAngle('90')).toEqual({ ok: true, degrees: 90 });
    expect(parseAngle('90°')).toEqual({ ok: true, degrees: 90 });
    expect(parseAngle('45 deg')).toEqual({ ok: true, degrees: 45 });
    expect(parseAngle('-15 degrees')).toEqual({ ok: true, degrees: -15 });
    expect(parseAngle('450')).toEqual({ ok: true, degrees: 90 });
    expect(parseAngle('12.5')).toEqual({ ok: true, degrees: 12.5 });
    expect(parseAngle('abc').ok).toBe(false);
    expect(parseAngle('').ok).toBe(false);
  });
  it('formats angles', () => {
    expect(formatAngle(90)).toBe('90°');
    expect(formatAngle(12.25)).toBe('12.3°');
    expect(formatAngle(-0.01)).toBe('0°');
  });
  it('formats areas', () => {
    expect(formatArea(304.8 * 304.8 * 400)).toBe('400 sq ft');
    expect(formatArea(304.8 * 304.8 * 12.34)).toBe('12.3 sq ft');
    expect(formatArea(2_500_000, { system: 'metric' })).toBe('2.50 m²');
  });
  it('formats weights', () => {
    expect(formatWeight(lb(300))).toBe('300 lb');
    expect(formatWeight(100, 'metric')).toBe('100 kg');
  });
});
