import { z } from 'zod';

/** Stable identifier (UUID for user-created entities; readable slugs for built-in definitions). */
export const IdSchema = z.string().min(1);

/**
 * Numeric bounds (R-003). Coordinates, sizes and elevations are bounded so that garbage (a
 * mistyped 1e12, a corrupt file, a bad script) can never reach the store, persistence or the
 * analyzers (a huge coordinate blows up the walkability grid). The limits are far outside anything
 * a building can be: ±1 km of plan, 50 m of size.
 */
export const MAX_COORD_MM = 1_000_000;
export const MAX_SIZE_MM = 50_000;
/** Smallest size a real object may have (1 mm); smaller is a typo or a unit mistake. */
export const MIN_SIZE_MM = 1;

/** Millimeters (canonical length unit): a plan coordinate or offset. */
export const MmSchema = z.number().finite().min(-MAX_COORD_MM, `Must be within ${MAX_COORD_MM / 1000} m of the origin.`).max(MAX_COORD_MM, `Must be within ${MAX_COORD_MM / 1000} m of the origin.`);
export const PositiveMmSchema = z.number().finite().positive().max(MAX_SIZE_MM, `Must be ${MAX_SIZE_MM / 1000} m or less.`);
export const NonNegativeMmSchema = z.number().finite().nonnegative().max(MAX_SIZE_MM, `Must be ${MAX_SIZE_MM / 1000} m or less.`);
/** A physical dimension of an object, vehicle or feature (width/depth/height). */
export const DimensionMmSchema = z
  .number()
  .finite()
  .min(MIN_SIZE_MM, `Must be at least ${MIN_SIZE_MM} mm.`)
  .max(MAX_SIZE_MM, `Must be ${MAX_SIZE_MM / 1000} m or less.`);

/** Degrees, clockwise on screen. Commands normalize stored rotations into [0, 360). */
export const DegreesSchema = z.number().finite().min(-360_000).max(360_000);

export const PointSchema = z.object({ x: MmSchema, y: MmSchema });
export type PointData = z.infer<typeof PointSchema>;

export const PoseSchema = z.object({ x: MmSchema, y: MmSchema, rotation: DegreesSchema });
export type PoseData = z.infer<typeof PoseSchema>;

/** CSS hex color (#rgb, #rrggbb or #rrggbbaa). */
export const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Expected a hex color like #3a7bd5');

/** ISO-8601 timestamp. */
export const TimestampSchema = z.string().min(1);

export const LAYER_IDS = [
  'architecture',
  'electrical',
  'lighting',
  'storage',
  'woodworking',
  'vehicle',
  'clearances',
  'measurements',
  'zones',
  'dust',
  'general',
] as const;
export const LayerIdSchema = z.enum(LAYER_IDS);
export type LayerId = z.infer<typeof LayerIdSchema>;

/** Reference to an entity in the project (for measurement anchors, warnings, relationships). */
export const ENTITY_KINDS = ['object', 'wall', 'vertex', 'feature', 'electrical', 'light', 'vehicle', 'zone', 'measurement', 'duct', 'fitting'] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKindSchema>;
export const EntityRefSchema = z.object({ kind: EntityKindSchema, id: IdSchema });
export type EntityRef = z.infer<typeof EntityRefSchema>;
