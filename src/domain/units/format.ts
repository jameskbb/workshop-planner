import { MM_PER_INCH, type Mm } from './length';

export type UnitSystem = 'imperial' | 'metric';
export type MetricDisplayUnit = 'mm' | 'cm' | 'm';

export interface FormatLengthOptions {
  system?: UnitSystem;
  /** Imperial fractional precision as the denominator: 1, 2, 4, 8, 16, 32 or 64. Default 16 (1/16"). */
  precision?: number;
  /**
   * Imperial style.
   * - 'auto' (default): values below {@link FormatLengthOptions.feetThresholdInches} show inches only (18"),
   *   larger values show feet-inches (4' 6").
   * - 'feet-inches': always feet-inches (0' 6").
   * - 'inches': always inches (54").
   */
  imperialStyle?: 'auto' | 'feet-inches' | 'inches';
  /** Threshold for 'auto' imperial style. Default 24 (inches). */
  feetThresholdInches?: number;
  metricUnit?: MetricDisplayUnit;
  /** Decimal places for metric display. Defaults: mm 0, cm 1, m 3. */
  metricDecimals?: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function fractionString(numerator: number, denominator: number): string {
  if (numerator === 0) return '';
  const g = gcd(numerator, denominator);
  return `${numerator / g}/${denominator / g}`;
}

/** Format inches (already a non-negative number) at the given fractional precision. */
function formatInchesPart(totalSixteenths: number, denominator: number): string {
  const whole = Math.floor(totalSixteenths / denominator);
  const frac = totalSixteenths - whole * denominator;
  const fracStr = fractionString(frac, denominator);
  if (whole === 0 && fracStr) return fracStr;
  return fracStr ? `${whole} ${fracStr}` : `${whole}`;
}

/**
 * Format canonical millimeters for display.
 *
 * Imperial: 1371.6 → 4' 6" ; 457.2 → 18" ; 1384.3 → 4' 6 1/2".
 * Metric: 1371.6 → "1372 mm" (mm), "137.2 cm", "1.372 m".
 */
export function formatLength(mm: Mm, options: FormatLengthOptions = {}): string {
  const { system = 'imperial' } = options;
  if (!Number.isFinite(mm)) return 'n/a';
  return system === 'imperial' ? formatImperial(mm, options) : formatMetric(mm, options);
}

function formatImperial(mm: Mm, options: FormatLengthOptions): string {
  const precision = normalizePrecision(options.precision ?? 16);
  const style = options.imperialStyle ?? 'auto';
  const threshold = options.feetThresholdInches ?? 24;
  const negative = mm < 0;
  const inchesAbs = Math.abs(mm) / MM_PER_INCH;
  // Work in integer fractional units to avoid float carry bugs (e.g. 11 15.99/16" must become 1' 0").
  const units = Math.round(inchesAbs * precision);
  if (units === 0) return `0"`;
  const sign = negative ? '-' : '';
  const perFoot = 12 * precision;
  const useFeet = style === 'feet-inches' || (style === 'auto' && units >= threshold * precision);
  if (!useFeet) return `${sign}${formatInchesPart(units, precision)}"`;
  const ft = Math.floor(units / perFoot);
  const rem = units - ft * perFoot;
  return `${sign}${ft}' ${formatInchesPart(rem, precision)}"`;
}

function normalizePrecision(p: number): number {
  const allowed = [1, 2, 4, 8, 16, 32, 64];
  return allowed.includes(p) ? p : 16;
}

function formatMetric(mm: Mm, options: FormatLengthOptions): string {
  const unit = options.metricUnit ?? 'mm';
  const decimals = options.metricDecimals ?? (unit === 'mm' ? 0 : unit === 'cm' ? 1 : 3);
  const divisor = unit === 'mm' ? 1 : unit === 'cm' ? 10 : 1000;
  const v = mm / divisor;
  const fixed = v.toFixed(decimals);
  // Avoid "-0"
  const cleaned = /^-0(?:\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
  return `${cleaned} ${unit}`;
}

export interface FormatAreaOptions {
  system?: UnitSystem;
  decimals?: number;
}

/** Format an area given in mm². Imperial → sq ft, metric → m². */
export function formatArea(mm2: number, options: FormatAreaOptions = {}): string {
  const { system = 'imperial' } = options;
  if (!Number.isFinite(mm2)) return 'n/a';
  if (system === 'imperial') {
    const sqft = mm2 / (304.8 * 304.8);
    const decimals = options.decimals ?? (Math.abs(sqft) >= 100 ? 0 : 1);
    return `${sqft.toFixed(decimals)} sq ft`;
  }
  const m2 = mm2 / 1e6;
  return `${m2.toFixed(options.decimals ?? 2)} m²`;
}

/** Format degrees with up to one decimal: 90 → "90°", 12.25 → "12.3°". */
export function formatAngle(degrees: number, decimals = 1): string {
  if (!Number.isFinite(degrees)) return 'n/a';
  const f = Number(degrees.toFixed(decimals));
  return `${f === 0 ? 0 : f}°`;
}

/** Format a weight given in kilograms for the configured unit system. */
export function formatWeight(kg: number, system: UnitSystem = 'imperial'): string {
  if (!Number.isFinite(kg)) return 'n/a';
  return system === 'imperial' ? `${Math.round(kg * 2.2046226218)} lb` : `${Math.round(kg)} kg`;
}

/** Pounds → kilograms (weights are stored in kg). */
export const lb = (pounds: number): number => Math.round(pounds * 0.45359237 * 100) / 100;
