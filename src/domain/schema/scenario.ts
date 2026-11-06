import { z } from 'zod';
import {
  ColorSchema,
  DegreesSchema,
  DimensionMmSchema,
  EntityRefSchema,
  IdSchema,
  MmSchema,
  NonNegativeMmSchema,
  PointSchema,
  PositiveMmSchema,
  TimestampSchema,
} from './common';
import { GroupSchema, PlacedObjectSchema } from './objects';

// ───────────────────────────── vehicles ─────────────────────────────

export const VehicleDoorSchema = z.object({
  id: z.enum(['driver-front', 'passenger-front', 'driver-rear', 'passenger-rear']),
  hingeFromFront: PositiveMmSchema,
  length: PositiveMmSchema,
  openAngle: z.number().min(10).max(90),
});
export type VehicleDoor = z.infer<typeof VehicleDoorSchema>;

export const DesiredClearanceSchema = z.object({
  driver: NonNegativeMmSchema,
  passenger: NonNegativeMmSchema,
  front: NonNegativeMmSchema,
  rear: NonNegativeMmSchema,
});
export type DesiredClearanceData = z.infer<typeof DesiredClearanceSchema>;

export const VEHICLE_TEMPLATE_IDS = [
  'compact-car',
  'sedan',
  'sports-car',
  'midsize-suv',
  'full-size-suv',
  'pickup-truck',
  'crew-cab-pickup',
] as const;

/** Entry simulation setup (garage opening + driveway approach). */
export const VehicleEntrySchema = z.object({
  /** Architectural feature id of the garage door the vehicle enters through. */
  openingFeatureId: IdSchema.optional(),
  /** Degrees off straight-in (positive = approach angled clockwise). */
  approachAngle: DegreesSchema.default(0),
  /** How far outside the opening the maneuver starts (mm). */
  approachDistance: PositiveMmSchema.default(6000),
  direction: z.enum(['forward', 'reverse']).default('forward'),
});
export type VehicleEntry = z.infer<typeof VehicleEntrySchema>;

/**
 * A vehicle is a first-class object. Pose (x, y) is the body center; rotation 0 means the FRONT
 * faces +y (south). The driver side is the vehicle's left for left-hand drive.
 */
export const VehicleSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  templateId: z.string().optional(),
  x: MmSchema,
  y: MmSchema,
  rotation: DegreesSchema,
  length: DimensionMmSchema,
  width: DimensionMmSchema,
  height: DimensionMmSchema,
  /** Overall width including unfolded mirrors. */
  mirrorWidth: PositiveMmSchema,
  foldedMirrorWidth: PositiveMmSchema.optional(),
  mirrorsFolded: z.boolean().default(false),
  wheelbase: PositiveMmSchema,
  frontOverhang: PositiveMmSchema,
  /** Curb-to-curb turning radius (mm). */
  turningRadius: PositiveMmSchema,
  driverSide: z.enum(['left', 'right']).default('left'),
  doors: z.array(VehicleDoorSchema),
  rearAccess: z.object({ kind: z.enum(['trunk', 'hatch', 'tailgate']), depth: PositiveMmSchema }),
  hoodAccessDepth: PositiveMmSchema,
  desiredClearance: DesiredClearanceSchema,
  state: z.enum(['parked', 'doors-open']).default('parked'),
  entry: VehicleEntrySchema.optional(),
  color: ColorSchema.optional(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  notes: z.string().default(''),
});
export type Vehicle = z.infer<typeof VehicleSchema>;
export type VehicleInput = z.input<typeof VehicleSchema>;

// ───────────────────────────── lighting ─────────────────────────────

export const LightingFixtureSchema = z.object({
  id: IdSchema,
  kind: z.enum(['ceiling-fixture', 'shop-light', 'task-light']),
  name: z.string().min(1),
  x: MmSchema,
  y: MmSchema,
  rotation: DegreesSchema.default(0),
  length: PositiveMmSchema,
  width: PositiveMmSchema,
  /** Mounting height of the fixture (mm above floor). */
  elevation: NonNegativeMmSchema,
  lumens: z.number().positive(),
  /** Beam angle in degrees (120 for typical LED shop lights). */
  beamAngle: z.number().min(10).max(180).default(120),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  notes: z.string().default(''),
});
export type LightingFixture = z.infer<typeof LightingFixtureSchema>;

// ───────────────────────────── zones ─────────────────────────────

export const WORKFLOW_ZONE_KINDS = [
  'parking',
  'woodworking',
  'assembly',
  'lumber-storage',
  'finishing',
  'automotive',
  'lawn-equipment',
  'tool-storage',
  'walking-aisle',
  'staging',
  'project-storage',
  'other',
] as const;
export const WorkflowZoneSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: z.enum(WORKFLOW_ZONE_KINDS),
  points: z.array(PointSchema).min(3),
  color: ColorSchema.optional(),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  notes: z.string().default(''),
});
export type WorkflowZone = z.infer<typeof WorkflowZoneSchema>;

// ───────────────────────────── measurements ─────────────────────────────

export const MeasurementSchema = z.object({
  id: IdSchema,
  kind: z.enum(['point', 'wall-object', 'object-object', 'clearance', 'angular']),
  a: PointSchema,
  b: PointSchema,
  /** Third point for angular measurements (angle at `a` between a→b and a→c). */
  c: PointSchema.optional(),
  /** Live anchors: when set, endpoints follow these entities. */
  anchorA: EntityRefSchema.optional(),
  anchorB: EntityRefSchema.optional(),
  label: z.string().optional(),
  /** Perpendicular offset of the dimension line (mm). */
  offset: MmSchema.default(0),
  /** Clearance measurements: which face of the anchored object (A) the clear distance is measured from. */
  side: z.enum(['front', 'back', 'left', 'right']).optional(),
  hidden: z.boolean().default(false),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

// ───────────────────────────── relationships / workflow ─────────────────────────────

export const RelationshipSchema = z.object({
  id: IdSchema,
  fromId: IdSchema,
  toId: IdSchema,
  kind: z.enum(['workflow', 'adjacent', 'power', 'dust']).default('workflow'),
  /** Named chain this edge belongs to, e.g. "Sheet goods" (edges ordered by `order`). */
  chain: z.string().optional(),
  order: z.number().int().default(0),
  /** 1 (rare) … 5 (constant). Weights travel-distance metrics. */
  frequency: z.number().int().min(1).max(5).default(3),
  label: z.string().optional(),
  color: ColorSchema.optional(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

// ───────────────────────────── dust collection ─────────────────────────────

export const DuctRunSchema = z.object({
  id: IdSchema,
  kind: z.enum(['rigid', 'flex']),
  diameter: PositiveMmSchema,
  points: z.array(PointSchema).min(2),
  elevation: NonNegativeMmSchema.optional(),
  /** Object ids connected at either end (collector / tool). */
  fromId: IdSchema.optional(),
  toId: IdSchema.optional(),
});
export type DuctRun = z.infer<typeof DuctRunSchema>;

export const DustFittingSchema = z.object({
  id: IdSchema,
  kind: z.enum(['blast-gate', 'hose-connection', 'wye', 'reducer']),
  x: MmSchema,
  y: MmSchema,
  runId: IdSchema.optional(),
});
export type DustFitting = z.infer<typeof DustFittingSchema>;

// ───────────────────────────── warnings ─────────────────────────────

export const WarningAckSchema = z.object({
  status: z.enum(['acknowledged', 'ignored']),
  at: TimestampSchema,
  note: z.string().optional(),
});
export type WarningAck = z.infer<typeof WarningAckSchema>;

// ───────────────────────────── scenario ─────────────────────────────

/**
 * A layout alternative. Room geometry, architecture and electrical are SHARED project-wide;
 * everything a user arranges lives here. Duplicating a scenario deep-copies this object and keeps
 * entity ids (so the same physical item has the same id in every scenario).
 */
export const ScenarioSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  objects: z.array(PlacedObjectSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  vehicles: z.array(VehicleSchema).default([]),
  lights: z.array(LightingFixtureSchema).default([]),
  zones: z.array(WorkflowZoneSchema).default([]),
  measurements: z.array(MeasurementSchema).default([]),
  relationships: z.array(RelationshipSchema).default([]),
  dust: z
    .object({ runs: z.array(DuctRunSchema).default([]), fittings: z.array(DustFittingSchema).default([]) })
    .default({ runs: [], fittings: [] }),
  /** Warning id → acknowledgment. Warning ids are stable (see src/analysis). */
  acknowledgedWarnings: z.record(z.string(), WarningAckSchema).default({}),
  /** Per-feature scenario data (see docs/ARCHITECTURE.md "Extensions"). */
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;
