/**
 * Canonical length handling.
 *
 * Every length stored anywhere in a project is a number of MILLIMETERS, quantized to
 * 1/1000 µm = 0.000001 mm (see {@link quantize}). Imperial and metric are purely input/display
 * formats. Quantizing at every parse/commit boundary keeps values on a fixed lattice, so repeated
 * conversions and edits cannot accumulate floating-point drift.
 *
 * The lattice contains the fractional inches the UI offers *exactly* (R-013): 1/64" is
 * 0.396875 mm, 1/32" is 0.79375 mm and 1/16" is 1.5875 mm (all whole numbers of 0.000001 mm), as
 * well as every metric step (0.1 mm, 0.01 mm). On the old 0.01 mm lattice 1/16" snapped to 1.59 mm,
 * so a thousand 1/16" nudges drifted 2.5 mm (0.1"). Here they are exact at any number of steps.
 * Lengths stored by older versions are already on this lattice (0.01 is a multiple of 0.000001);
 * the v2→v3 migration in src/domain/serialization.ts re-snaps them anyway.
 */

/** Millimeters. A plain number alias (not branded) to keep geometry math frictionless. */
export type Mm = number;

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM_PER_CM = 10;
export const MM_PER_M = 1000;

/** Quantization step in millimeters (0.000001 mm, one nanometer). */
export const QUANTUM_MM = 0.000001;
/** Lattice steps per millimeter. */
const STEPS_PER_MM = 1_000_000;

/**
 * Snap a millimeter value onto the canonical lattice. Idempotent, so repeated edits stay put.
 * Normalizes -0 to 0.
 */
export function quantize(mm: number): Mm {
  if (!Number.isFinite(mm)) return mm;
  const q = Math.round(mm * STEPS_PER_MM) / STEPS_PER_MM;
  return q === 0 ? 0 : q;
}

/**
 * Tolerance at which two lengths are "the same length" for a human: half of the finest step the UI
 * can show (1/64" ≈ 0.4 mm and 0.1 mm metric), rounded down to 0.005 mm. Used for comparisons,
 * never for storage, which uses the lattice above.
 */
export const DISPLAY_EPSILON_MM = 0.005;

/** Inches → quantized mm. */
export const inches = (n: number): Mm => quantize(n * MM_PER_INCH);
/** Feet → quantized mm. */
export const feet = (n: number): Mm => quantize(n * 12 * MM_PER_INCH);
/** Feet + inches → quantized mm. */
export const feetInches = (ft: number, inch: number): Mm => quantize((ft * 12 + inch) * MM_PER_INCH);
/** Centimeters → quantized mm. */
export const cm = (n: number): Mm => quantize(n * MM_PER_CM);
/** Meters → quantized mm. */
export const meters = (n: number): Mm => quantize(n * MM_PER_M);

/** mm → inches (unrounded). */
export const toInches = (mm: Mm): number => mm / MM_PER_INCH;
/** mm → feet (unrounded). */
export const toFeet = (mm: Mm): number => mm / MM_PER_FOOT;

/** Two lengths are equal at display-irrelevant precision. */
export function lengthsEqual(a: Mm, b: Mm, tolerance = DISPLAY_EPSILON_MM): boolean {
  return Math.abs(a - b) <= tolerance;
}
