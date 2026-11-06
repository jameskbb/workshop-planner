/**
 * Per-project thresholds for the safety checks (pure; read by analyzers, edited in the Safety panel).
 * Stored as a project extension so every layout of a project is judged by the same rules.
 */
import { z } from 'zod';
import { defineExtension } from '@/domain/extensions';
import { feet, inches } from '@/domain/units';

export const SafetyPrefsSchema = z.object({
  /** Keep flammables / finishing work at least this far from hot appliances (mm). */
  hotDistance: z.number().positive(),
  /** Keep finishing / flammables at least this far from spark-producing tools (mm). */
  sparksDistance: z.number().positive(),
  /** Walkways narrower than this are reported (mm). */
  minWalkway: z.number().positive(),
});
export type SafetyPrefs = z.infer<typeof SafetyPrefsSchema>;

export const DEFAULT_SAFETY_PREFS: SafetyPrefs = { hotDistance: inches(36), sparksDistance: feet(10), minWalkway: inches(24) };

export const safetyPrefs = defineExtension('safety.prefs', SafetyPrefsSchema, DEFAULT_SAFETY_PREFS);
