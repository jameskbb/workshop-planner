import { MM_PER_CM, MM_PER_FOOT, MM_PER_INCH, MM_PER_M, quantize, type Mm } from './length';


export type LengthUnit = 'in' | 'ft' | 'mm' | 'cm' | 'm';

export interface ParseLengthOptions {
  /** Unit applied to a bare number such as "48". Defaults to inches. */
  defaultUnit?: LengthUnit;
  /** Accept a leading minus sign. Defaults to false (most dimensions are positive). */
  allowNegative?: boolean;
  /** Accept zero. Defaults to true. */
  allowZero?: boolean;
}

export type ParseLengthResult = { ok: true; mm: Mm } | { ok: false; error: string };

const UNIT_MM: Record<LengthUnit, number> = {
  in: MM_PER_INCH,
  ft: MM_PER_FOOT,
  mm: 1,
  cm: MM_PER_CM,
  m: MM_PER_M,
};

const IMPERIAL_ORDER: LengthUnit[] = ['ft', 'in'];
const METRIC_ORDER: LengthUnit[] = ['m', 'cm', 'mm'];

type Token =
  | { kind: 'num'; value: number; text: string }
  | { kind: 'slash' }
  | { kind: 'dash' }
  | { kind: 'unit'; unit: LengthUnit };

const UNIT_PATTERNS: Array<[RegExp, LengthUnit]> = [
  [/^(?:feet|foot|ft)\.?(?![a-z])/, 'ft'],
  [/^'(?!')/, 'ft'],
  [/^(?:inches|inch|in)\.?(?![a-z])/, 'in'],
  [/^(?:"|'')/, 'in'],
  [/^(?:millimeters?|millimetres?|mm)(?![a-z])/, 'mm'],
  [/^(?:centimeters?|centimetres?|cm)(?![a-z])/, 'cm'],
  [/^(?:meters?|metres?|m)(?![a-z])/, 'm'],
];

function normalizeInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[‘’′`´]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[−–\u2014]/g, '-')
    .replace(/½/g, ' 1/2')
    .replace(/¼/g, ' 1/4')
    .replace(/¾/g, ' 3/4');
}

function tokenize(s: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = s.slice(i);
    const num = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0]), text: num[0] });
      i += num[0].length;
      continue;
    }
    if (ch === '/') {
      tokens.push({ kind: 'slash' });
      i++;
      continue;
    }
    if (ch === '-') {
      tokens.push({ kind: 'dash' });
      i++;
      continue;
    }
    let matched = false;
    for (const [re, unit] of UNIT_PATTERNS) {
      const m = re.exec(rest);
      if (m) {
        tokens.push({ kind: 'unit', unit });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    return `Unexpected "${ch}"`;
  }
  return tokens;
}

interface Component {
  value: number;
  unit: LengthUnit | null;
}

const HINT = `Try something like 48", 4' 6", 4 ft 6 in, 4.5 ft, 1372 mm or 137.2 cm.`;

/**
 * Parse a user-typed length into canonical millimeters.
 *
 * Accepts: 48" · 4' · 4' 6" · 4'6" · 4'-6" · 4 ft 6 in · 54 in · 4.5 ft · 4'6-1/2" ·
 * 4' 6 1/2" · 1/2" · 3/4 (bare → default unit) · 1372 mm · 137.2 cm · 1.372 m · 1 m 20 cm.
 */
export function parseLength(raw: string, options: ParseLengthOptions = {}): ParseLengthResult {
  const { defaultUnit = 'in', allowNegative = false, allowZero = true } = options;
  const input = normalizeInput(raw);
  if (input === '') return { ok: false, error: 'Enter a length.' };

  const tokenized = tokenize(input);
  if (typeof tokenized === 'string') {
    return { ok: false, error: `Couldn't read "${raw.trim()}": ${tokenized}. ${HINT}` };
  }
  let tokens = tokenized;

  let sign = 1;
  if (tokens[0]?.kind === 'dash') {
    sign = -1;
    tokens = tokens.slice(1);
  }
  if (tokens.length === 0) return { ok: false, error: `Couldn't read "${raw.trim()}". ${HINT}` };

  const components: Component[] = [];
  let i = 0;
  const fail = (why?: string): ParseLengthResult => ({
    ok: false,
    error: `Couldn't read "${raw.trim()}"${why ? `: ${why}` : ''}. ${HINT}`,
  });

  while (i < tokens.length) {
    let t = tokens[i];
    // A dash directly after a unit is an architectural separator (4'-6").
    if (t?.kind === 'dash' && components.length > 0 && components[components.length - 1]!.unit !== null) {
      i++;
      t = tokens[i];
    }
    if (!t || t.kind !== 'num') return fail('expected a number');
    let value = t.value;
    i++;
    // Fraction a/b
    if (tokens[i]?.kind === 'slash') {
      const den = tokens[i + 1];
      if (!den || den.kind !== 'num') return fail('incomplete fraction');
      if (!Number.isInteger(value) || !Number.isInteger(den.value)) return fail('fractions need whole numbers');
      if (den.value === 0) return fail('a fraction cannot divide by zero');
      value = value / den.value;
      i += 2;
    } else {
      // Mixed number: "6 1/2" or "6-1/2"
      let j = i;
      if (tokens[j]?.kind === 'dash') j++;
      const n2 = tokens[j];
      if (n2?.kind === 'num' && tokens[j + 1]?.kind === 'slash') {
        const den = tokens[j + 2];
        if (!den || den.kind !== 'num') return fail('incomplete fraction');
        if (!Number.isInteger(n2.value) || !Number.isInteger(den.value)) return fail('fractions need whole numbers');
        if (den.value === 0) return fail('a fraction cannot divide by zero');
        if (n2.value >= den.value) return fail('the fraction part should be less than one');
        value = value + n2.value / den.value;
        i = j + 3;
      }
    }
    let unit: LengthUnit | null = null;
    const u = tokens[i];
    if (u?.kind === 'unit') {
      unit = u.unit;
      i++;
    }
    components.push({ value, unit });
  }

  // Resolve unit-less components.
  for (let k = 0; k < components.length; k++) {
    const c = components[k]!;
    if (c.unit !== null) continue;
    if (components.length === 1) {
      c.unit = defaultUnit;
    } else if (k === components.length - 1 && components[k - 1]?.unit === 'ft') {
      c.unit = 'in'; // 4' 6 → 4' 6"
    } else if (k === components.length - 1 && components[k - 1]?.unit === 'm') {
      return fail('add a unit after the second number (e.g. 1 m 20 cm)');
    } else {
      return fail('separate numbers need units, e.g. 4\' 6"');
    }
  }

  const units = components.map((c) => c.unit!) as LengthUnit[];
  const isImperial = units.every((u) => u === 'ft' || u === 'in');
  const isMetric = units.every((u) => u === 'm' || u === 'cm' || u === 'mm');
  if (!isImperial && !isMetric) return fail("don't mix imperial and metric units");
  const order = isImperial ? IMPERIAL_ORDER : METRIC_ORDER;
  let last = -1;
  for (const u of units) {
    const idx = order.indexOf(u);
    if (idx <= last) return fail('units must go from largest to smallest, each used once');
    last = idx;
  }

  // Sum in the smallest unit of the system first, then convert once, so that every
  // spelling of a value (54", 4' 6", 4.5 ft) goes through the identical float operation.
  let total: number;
  if (isImperial) {
    let totalInches = 0;
    for (const c of components) totalInches += c.unit === 'ft' ? c.value * 12 : c.value;
    total = totalInches * MM_PER_INCH;
  } else {
    total = 0;
    for (const c of components) total += c.value * UNIT_MM[c.unit!];
  }
  const mm = quantize(sign * total);
  if (!Number.isFinite(mm)) return fail('number is too large');
  if (mm < 0 && !allowNegative) return { ok: false, error: 'Length must be positive.' };
  if (mm === 0 && !allowZero) return { ok: false, error: 'Length must be greater than zero.' };
  return { ok: true, mm };
}

/** Parse or throw; convenient for fixtures and tests. */
export function mustParseLength(raw: string, options?: ParseLengthOptions): Mm {
  const r = parseLength(raw, options);
  if (!r.ok) throw new Error(r.error);
  return r.mm;
}

export type ParseAngleResult = { ok: true; degrees: number } | { ok: false; error: string };

/** Parse an angle in degrees: "90", "90°", "90 deg", "-45", "12.5 degrees". Result normalized to (-360, 360). */
export function parseAngle(raw: string): ParseAngleResult {
  const s = raw.trim().toLowerCase().replace(/−/g, '-');
  const m = /^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:°|deg|degs|degree|degrees)?$/.exec(s);
  if (!m) return { ok: false, error: `Couldn't read "${raw.trim()}" as an angle. Try 90 or 45°.` };
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return { ok: false, error: 'Angle is not a number.' };
  const degrees = Math.round((v % 360) * 1000) / 1000;
  return { ok: true, degrees: degrees === 0 ? 0 : degrees };
}
