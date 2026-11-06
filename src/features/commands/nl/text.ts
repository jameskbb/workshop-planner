/**
 * Text helpers for the deterministic command parser: normalization, word stemming, and extraction
 * of lengths ("30 inches", 2' 6", 4.5 ft, 762 mm) and angles ("90 degrees", 45°) from free text.
 * Lengths go through the app's own unit parser, so every spelling gives the identical value.
 */
import { parseLength, type LengthUnit } from '@/domain/units';

/** Lowercase, unify quotes/dashes, drop politeness and trailing punctuation. */
export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’′`´]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[−–\u2014]/g, '-')
    .replace(/°/g, ' degrees ')
    .replace(/[!?;]+/g, ' ')
    .replace(/\.(\s|$)/g, ' ')
    .replace(/\b(?:please|kindly|could you|can you|would you|i want to|i'd like to|let's|lets)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const IRREGULAR: Record<string, string> = { shelves: 'shelf', benches: 'bench', boxes: 'box', feet: 'foot', racks: 'rack', vacuums: 'vacuum', mitre: 'miter' };

/** Crude singular stem (cabinets → cabinet, benches → bench). */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w]!;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Split into word tokens (letters/digits), stemmed. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(stem);
}

const NUM = String.raw`(?:\d+(?:\.\d+)?(?:\s+\d+\/\d+|-\d+\/\d+|\/\d+)?|\.\d+)`;
const UNIT = String.raw`(?:feet|foot|ft\.?|'(?!')|inches|inch|in\.?(?![a-z])|"|''|millimeters?|millimetres?|mm|centimeters?|centimetres?|cm|meters?|metres?|m(?![a-z]))`;
const LENGTH_RE = new RegExp(String.raw`(${NUM})\s*(${UNIT})(?:\s*-?\s*(${NUM})\s*(${UNIT})?)?`, 'g');

export interface Found<T> {
  value: T;
  /** Matched substring and its position. */
  text: string;
  index: number;
}

/** Every explicit length (with units) in the text. */
export function findLengths(text: string): Array<Found<number>> {
  const out: Array<Found<number>> = [];
  LENGTH_RE.lastIndex = 0;
  for (let m = LENGTH_RE.exec(text); m; m = LENGTH_RE.exec(text)) {
    let candidate = m[0];
    // "2 ft 6" keeps the trailing inches; a trailing bare number after inches is not part of it.
    if (m[3] && !m[4] && !/^(?:feet|foot|ft|')/.test(m[2]!.trim())) candidate = `${m[1]}${m[2]}`;
    const r = parseLength(candidate.replace(/\s*-\s*(?=\d)/, ' '));
    if (r.ok) out.push({ value: r.mm, text: candidate, index: m.index });
    else {
      const r2 = parseLength(`${m[1]}${m[2]}`);
      if (r2.ok) out.push({ value: r2.mm, text: `${m[1]}${m[2]}`, index: m.index });
    }
    LENGTH_RE.lastIndex = m.index + candidate.length;
  }
  return out;
}

/** A length with units, or else a bare number in the project's default unit. */
export function findLength(text: string, defaultUnit: LengthUnit): Found<number> | null {
  const explicit = findLengths(text);
  if (explicit.length) return explicit[0]!;
  const m = /(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/.exec(text);
  if (!m) return null;
  const r = parseLength(m[1]!, { defaultUnit });
  return r.ok ? { value: r.mm, text: m[1]!, index: m.index } : null;
}

/** First angle ("90 degrees", "45 deg", "a quarter turn", bare number as a fallback). */
export function findAngle(text: string, allowBare = true): Found<number> | null {
  const m = /(-?\d+(?:\.\d+)?)\s*(?:degrees?|degs?|deg)\b/.exec(text);
  if (m) return { value: Number(m[1]), text: m[0], index: m.index };
  if (/\bquarter turn\b/.test(text)) return { value: 90, text: 'quarter turn', index: text.indexOf('quarter turn') };
  if (/\b(?:half turn|turn (?:it )?around|around)\b/.test(text)) return { value: 180, text: 'half turn', index: 0 };
  if (!allowBare) return null;
  const b = /(?:^|\s)(-?\d+(?:\.\d+)?)(?=\s|$)/.exec(text);
  return b ? { value: Number(b[1]), text: b[1]!, index: b.index } : null;
}

/** Remove matched substrings (lengths/angles) so the rest can be read as names. */
export function without(text: string, parts: Array<Found<unknown> | null>): string {
  let t = text;
  for (const p of parts) if (p) t = t.replace(p.text, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export const COMPASS = ['north', 'south', 'east', 'west'] as const;
export type Compass = (typeof COMPASS)[number];
